do $$
    declare
    myrow record;
begin
        
  for myrow in
  SELECT
        'UPDATE ' || table_schema || '.' || table_name || 
        ' SET estimated_pop = NULL ' as dv 
        from information_schema.tables
            where table_name ilike 'settlement_name%'
            and table_schema = 'partitions_settlement_name'
            and table_type = 'BASE TABLE'
  LOOP
    begin 
      execute myrow.dv;
      exception when others then 
      end;
  end loop;

  for myrow in
  SELECT
        'REFRESH MATERIALIZED VIEW ' || table_schema || '.' || table_name || 
        '_latest' as dv 
        from information_schema.tables
            where table_name ilike 'settlement_name%'
            and table_schema = 'partitions_settlement_name'
            and table_type = 'BASE TABLE'
  LOOP
    begin 
      execute myrow.dv;
      exception when others then 
      end;
  end loop;

end;
$$;
