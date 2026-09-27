"""
backend.py

The entrypoint. All it does:
1. Import `app` from extensions.py (the shared Flask app every route
   module registers against).
2. Import every routes/*.py module - each one's @app.route(...)
   decorators run at import time, registering their endpoints on that
   same shared `app`. Nothing in this file defines a route directly
   anymore; this is just what makes sure every route module actually
   gets loaded.
3. Re-export `app` at module level, since gunicorn's start command
   (Render config) points at `backend:app` - that has to keep working
   unchanged.

Previously this single file held every route (~2000 lines). See
routes/ for where each group of endpoints now lives:
  - routes/auth.py          - login/signup/refresh/logout, /auth/me
  - routes/categories.py    - category CRUD/colour/combine/reorder
  - routes/admin.py         - roles/permissions/user management,
                              impersonation, token revocation
  - routes/transactions.py  - CSV upload, transaction list/delete,
                              the categorization pipeline endpoints
  - routes/charts.py        - /charts/summary
  - routes/health.py        - /health
extensions.py holds the shared Flask/JWT/limiter setup; shared.py holds
small helpers used by more than one route module.
"""
import os

from extensions import app
from backendLocalConfig import BACKEND_PORT

import routes.auth
import routes.categories
import routes.admin
import routes.admin_auth
import routes.transactions
import routes.charts
import routes.health
import routes.uploads
import routes.preferences

if __name__ == '__main__':
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(
        host='0.0.0.0',
        port=BACKEND_PORT,
        debug=debug,
    )
