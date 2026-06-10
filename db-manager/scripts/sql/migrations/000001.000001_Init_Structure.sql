CREATE TABLE test_ci_cd (
    id SERIAL,
    description character varying(20),
    shape public.geometry(Point,3857)
);

insert into test_ci_cd(description, shape) values ('my first test', ST_GeomFromText('POINT(0 0)', 3857));
