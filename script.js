WITH blocking AS (
  SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.query AS blocked_query,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.query AS blocking_query,
    blocking_activity.state AS blocking_state
  FROM pg_locks blocked_locks
  JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
  JOIN pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database = blocked_locks.database
    AND blocking_locks.relation = blocked_locks.relation
    AND blocking_locks.page = blocked_locks.page
    AND blocking_locks.tuple = blocked_locks.tuple
    AND blocking_locks.transactionid = blocked_locks.transactionid
    AND blocking_locks.classid = blocked_locks.classid
    AND blocking_locks.objid = blocked_locks.objid
    AND blocking_locks.objsubid = blocked_locks.objsubid
  JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
  WHERE NOT blocked_locks.granted
)
SELECT 
  blocked_pid,
  blocked_query,
  blocking_pid,
  blocking_query,
  blocking_state
FROM blocking;
