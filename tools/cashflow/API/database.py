import os
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

DATABASE_SESSION_POOLER = os.environ.get('DATABASE_SESSION_POOLER')

if not DATABASE_SESSION_POOLER:
    raise RuntimeError(
        'DATABASE_SESSION_POOLER environment variable not set - add the Supabase '
        'session pooler connection string to your .env file'
    )

# A small pool rather than one connection per request. Supabase's
# session pooler already pools underneath this, but keeping a pool on
# our side too avoids opening/closing a fresh connection on every
# single request, which adds latency and isn't necessary here.
#
# ThreadedConnectionPool (not SimpleConnectionPool) because gunicorn runs
# with --threads (and the LLM tier already saves from a background thread):
# concurrent getconn/putconn on the simple pool can hand one connection to
# two requests. It never blocks — it raises PoolError when all maxconn are
# out — so gunicorn threads + concurrent background saves must stay <= maxconn.
#
# minconn matters for speed: psycopg2 only KEEPS a returned connection while
# fewer than minconn are idle, otherwise it closes it. With minconn=1, every
# concurrent request beyond the first opened (and threw away) a fresh TLS
# connection to the database, ~1s cross-region. 3 keeps enough warm.
connection_pool = pool.ThreadedConnectionPool(
    minconn=3,
    maxconn=10,
    dsn=DATABASE_SESSION_POOLER,
    sslmode='require',
)


def get_connection():
    """Borrow a connection from the pool. Must be paired with
    release_connection() in a finally block, or the pool will run dry."""
    return connection_pool.getconn()


def release_connection(conn, discard=False):
    """Return a connection to the pool. Pass discard=True if the connection is broken."""
    if discard or conn.closed:
        try:
            conn.close()
        except Exception:
            pass
        connection_pool.putconn(conn, close=True)
    else:
        connection_pool.putconn(conn)