do $$
declare
    myrow record;
begin
for myrow in
SELECT
     'ALTER TABLE ' ||
     quote_ident(v.nspname) ||
     '.' ||
     quote_ident(v.tbl_name) ||
     ' DROP CONSTRAINT ' ||
     quote_ident(v.constraint_name)
         as viewq
FROM
    (
    SELECT cls_table.relname as tbl_name, ns.nspname, con.conname as constraint_name
       FROM pg_catalog.pg_constraint con
            INNER JOIN pg_catalog.pg_class rel
                       ON rel.oid = con.conrelid
            INNER JOIN pg_catalog.pg_namespace nsp
                       ON nsp.oid = connamespace
        inner join pg_class cls_table on con.conrelid = cls_table.oid
        inner join pg_class cls_target_table on con.confrelid = cls_target_table.oid
        inner JOIN pg_catalog.pg_namespace AS ns  ON cls_table.relnamespace = ns.oid
        where cls_target_table.relname = 'commits'
    ) v
loop
execute myrow.viewq;
end loop;
end;


$$

;