import os
from contextlib import asynccontextmanager
from functools import cached_property
from pathlib import Path
from typing import AsyncGenerator, List

import asyncpg
from pydantic import BaseModel, ConfigDict, Field

from lib.logger_utils import get_logger
from modules.params.common import (
    NoWhiteSpace,
    EnvVariableKey,
)
from lib.async_db_utils import ConnType, PoolType

log = get_logger(__name__)


# From AOPT shared/api_params/gmt/step_params_common/common.py
class GmtDbCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: NoWhiteSpace = Field(description="Geopode database username")

    password_key: EnvVariableKey = Field(
        description="Env. variable containing geopode database password"
    )
    pgpass_path_key: EnvVariableKey = Field(
        description="Env. variable containing geopode database PG_PASS path"
    )

    db_name: NoWhiteSpace = Field(description="Geopode database name", min_length=1)
    port: int = Field(description="Geopode database port", default=5432)

    hostname: NoWhiteSpace = Field(description="Geopode hostname")

    def write_pg_pass(self) -> Path:
        pw = os.environ[self.password_key]
        pgpass_path_str = os.environ[self.pgpass_path_key]

        if len(pgpass_path_str) <= 2:
            raise ValueError(f"Pg pass: [{pgpass_path_str}] too short")

        pgpass_path = Path(pgpass_path_str)

        if pgpass_path.exists():
            log.debug(
                f"Already exists -- PG_PASS in {pgpass_path} using pw key {self.password_key}"
            )
            return pgpass_path

        log.debug(f"Storing PG_PASS in {pgpass_path} using pw key {self.password_key}")
        pgpass_content = f"*:*:*:*:{pw}\n"

        pgpass_path.parent.mkdir(exist_ok=True, parents=True)

        # Create (or overwrite) the .pgpass file and write the content
        with open(pgpass_path, "w") as file:
            file.write(pgpass_content)

        # Set the file permissions to 0600
        os.chmod(pgpass_path, 0o600)

        return pgpass_path

    # asyncpg connections are not context managers
    # https://github.com/MagicStack/asyncpg/issues/583
    @asynccontextmanager
    async def get_asyncpg_connection(
        self, readonly: bool = False
    ) -> AsyncGenerator[ConnType, None]:
        pw = os.environ[self.password_key]

        # as this is not shelling, we pass the password directly instead of
        # using a pg pass file
        conn = await asyncpg.connect(
            user=self.username,
            database=self.db_name,
            host=self.hostname,
            port=self.port,
            password=pw,
        )

        try:
            if readonly:
                await conn.execute(
                    "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"
                )

            db_name = await conn.fetchval("SELECT current_database();")
            log.debug(f"Connected to database: {db_name} with readonly=[{readonly}]")

            # gmt is the name of the local database
            # we need to write to training / prod for the exports
            # if not readonly and db_name not in ("gmt_dev", "gmt_test", "gmt"):
            #     raise Exception(f"Connected to [{db_name}] and readonly is False")

            yield conn
        finally:
            await conn.close()

    def get_asyncpg_pool(self) -> PoolType:
        pw = os.environ[self.password_key]

        pool = asyncpg.create_pool(
            user=self.username,
            database=self.db_name,
            host=self.hostname,
            port=self.port,
            password=pw,
            min_size=1,
            max_size=4,
            # init=set_read_only
        )

        if pool is None:
            raise Exception("Pool is none!")

        return pool

    @cached_property
    def gdal_conn_str(self) -> str:
        # Note, no password because the pg_pass file is expected to exist
        return (
            'PG:"'
            f"host='{self.hostname}' "
            f"port='{self.port}' "
            f"dbname='{self.db_name}' "
            f"user='{self.username}' "
            '"'
        )

    def gdal_conn_str_with_active_schema(self, schema_name: str) -> str:
        return (
            'PG:"'
            f"host='{self.hostname}' "
            f"port='{self.port}' "
            f"dbname='{self.db_name}' "
            f"user='{self.username}' "
            f"ACTIVE_SCHEMA='{schema_name}'"
            '"'
        )

    def get_common_ogr2ogr_args(self, schema_name: str) -> List[str]:
        return [
            self.gdal_conn_str_with_active_schema(schema_name),
            "--config PG_USE_COPY YES",
            "-f PostgreSQL",
            "--config OGR_PG_ENABLE_METADATA NO",
            f"-lco SCHEMA={schema_name}",
            "-lco EXTRACT_SCHEMA_FROM_LAYER_NAME=NO",
            "-lco SPATIAL_INDEX=NONE",
            "-lco PRECISION=NO",
            "-lco GEOMETRY_NAME=geom",
            "-lco FID=id",
            "-t_srs EPSG:4326",
        ]

    def get_sql_alchemy_connection_string(self) -> str:
        password = os.environ[self.password_key]
        return r"postgresql://%s:%s@%s:%s/%s" % (
            self.username,
            password,
            self.hostname,
            self.port,
            self.db_name,
        )
