Code shared between excel export and natview api export

Perhaps in future more

Both these exports first consolidate data into a schema
for faster/easier calculations (rather than using the partitioned tables directly)



Raw data is data as is; partitioned => a single table for faster / easier joins
without worrying about boundary polygon indexes

Consolidated data is the form the api csv export takes, and is used
in the excel export too (not as is, but certain columns)