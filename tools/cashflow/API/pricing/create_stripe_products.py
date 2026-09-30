"""
pricing/create_stripe_products.py

One-shot script: creates the Stripe products and prices for the pro plan,
then writes the resulting price IDs into billing_settings.

Run ONCE after Stripe keys are added to .env:
    cd tools/cashflow/API
    python pricing/create_stripe_products.py

Safe to re-run — looks up existing products/prices by name before creating.
Requires: STRIPE_SECRET_KEY in .env (or environment).
"""
import os
import sys

# Load .env from the API directory
from pathlib import Path
_env_path = Path(__file__).parent.parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import urllib.request
import urllib.parse
import json
import base64

SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
if not SECRET_KEY:
    print('ERROR: STRIPE_SECRET_KEY not set in .env')
    sys.exit(1)

if SECRET_KEY.startswith('sk_live_'):
    print('WARNING: You are using a LIVE Stripe key.')
    confirm = input('Type YES to continue with live keys: ')
    if confirm.strip() != 'YES':
        print('Aborted.')
        sys.exit(0)


def stripe_request(method: str, path: str, data: dict = None) -> dict:
    url = f'https://api.stripe.com/v1{path}'
    auth = base64.b64encode(f'{SECRET_KEY}:'.encode()).decode()
    headers = {
        'Authorization': f'Basic {auth}',
        'Content-Type': 'application/x-www-form-urlencoded',
    }
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = json.loads(e.read())
        print(f'Stripe error: {err}')
        raise


def find_product(name: str):
    products = stripe_request('GET', '/products?limit=100&active=true')
    for p in products.get('data', []):
        if p.get('name') == name:
            return p
    return None


def find_price(product_id: str, interval: str, amount: int):
    prices = stripe_request('GET', f'/prices?product={product_id}&limit=100&active=true')
    for p in prices.get('data', []):
        if (p.get('recurring', {}).get('interval') == interval
                and p.get('unit_amount') == amount
                and p.get('currency') == 'gbp'):
            return p
    return None


# ── Create / find product ─────────────────────────────────────────────────────
print('Looking up Cashflow Pro product...')
product = find_product('Cashflow Pro')
if product:
    print(f'  Found existing product: {product["id"]}')
else:
    product = stripe_request('POST', '/products', {
        'name': 'Cashflow Pro',
        'description': 'Full access to Cashflow — transaction tracking, charts, and categorisation.',
    })
    print(f'  Created product: {product["id"]}')

product_id = product['id']

# ── Create / find prices ──────────────────────────────────────────────────────
# Amounts in pence (GBP). Adjust before running with live keys.
MONTHLY_PENCE = 999   # £9.99/month
YEARLY_PENCE  = 8999  # £89.99/year

print('Looking up monthly price...')
monthly = find_price(product_id, 'month', MONTHLY_PENCE)
if monthly:
    print(f'  Found existing monthly price: {monthly["id"]}')
else:
    monthly = stripe_request('POST', '/prices', {
        'product': product_id,
        'unit_amount': str(MONTHLY_PENCE),
        'currency': 'gbp',
        'recurring[interval]': 'month',
        'nickname': 'Pro Monthly',
    })
    print(f'  Created monthly price: {monthly["id"]}')

print('Looking up yearly price...')
yearly = find_price(product_id, 'year', YEARLY_PENCE)
if yearly:
    print(f'  Found existing yearly price: {yearly["id"]}')
else:
    yearly = stripe_request('POST', '/prices', {
        'product': product_id,
        'unit_amount': str(YEARLY_PENCE),
        'currency': 'gbp',
        'recurring[interval]': 'year',
        'nickname': 'Pro Yearly',
    })
    print(f'  Created yearly price: {yearly["id"]}')

# ── Write price IDs into billing_settings ─────────────────────────────────────
print('\nWriting price IDs to billing_settings...')

# Load DB connection the same way the app does
sys.path.insert(0, str(Path(__file__).parent.parent))
from database import get_connection, release_connection

conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE billing_settings SET value = %s, updated_at = NOW()
             WHERE key = 'stripe_price_id_pro_monthly'
        """, (monthly['id'],))
        cur.execute("""
            UPDATE billing_settings SET value = %s, updated_at = NOW()
             WHERE key = 'stripe_price_id_pro_yearly'
        """, (yearly['id'],))
    conn.commit()
    print(f'  stripe_price_id_pro_monthly = {monthly["id"]}')
    print(f'  stripe_price_id_pro_yearly  = {yearly["id"]}')
except Exception as e:
    print(f'DB write failed: {e}')
    print('Price IDs were created in Stripe but not saved to DB.')
    print(f'  Monthly: {monthly["id"]}')
    print(f'  Yearly:  {yearly["id"]}')
    print('Add them manually in the admin billing panel.')
finally:
    release_connection(conn)

print('\nDone.')
