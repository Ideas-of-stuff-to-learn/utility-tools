"""
adminCliCommon.py

Shared helpers for the Cashflow category admin CLI tools - login,
fetching the category list (name-only or full detail), the standard
"pick one from a numbered list" prompt, the shared colour palette +
picker (with real terminal colour swatches), and hex/RGB conversion.
Every admin*.py script imports these instead of keeping its own copy,
so there's exactly one implementation of each to maintain (previously
login(), fetch_categories(), and the colour palette/picker were all
duplicated across multiple scripts).

Not a script itself - nothing here has a __main__ block, it's only
meant to be imported.
"""

import json
import os

import requests

# Single source of truth for the production backend URL (repo root).
with open(os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend-url.json"), encoding="utf-8") as _f:
    BASE_URL = json.load(_f)["url"]


def login(username, password):
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"username": username, "password": password},
    )
    data = response.json()
    if not response.ok:
        raise RuntimeError(data.get("error", "Login failed"))
    return data["access_token"]


def fetch_categories(token):
    response = requests.get(
        f"{BASE_URL}/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch categories")
    return [c["name"] for c in data["categories"]]


def fetch_categories_full(token):
    """Like fetch_categories() but keeps color and defaultColor too,
    not just the name. Used anywhere a script needs to SHOW a
    category's current colour(s), not just pick it by name -
    listCategoriesAdmin.py and the colour-changing tools all need
    this; the plain numbered pickers (rename, delete, combine) only
    ever needed names, hence the two separate functions."""
    response = requests.get(
        f"{BASE_URL}/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch categories")
    return data["categories"]


class SessionExpired(Exception):
    """Raised when the backend rejects a request with 401 - the
    token's expired, been revoked (via /auth/logout or
    /admin/tokens/revoke), or is otherwise no longer valid. Distinct
    from a plain permission failure (403, which check_response() below
    still raises as a RuntimeError) - a 401 means "this SESSION is no
    longer good," not "this account isn't allowed to do that." Callers
    (categoryAdminCli.py's main loop) catch this specifically to
    re-prompt login rather than just printing a generic failure and
    looping back to a menu that will keep failing the same way on
    every subsequent attempt with the same dead token."""
    pass


def check_response(response, fallback_message):
    """Shared response-checking helper - every request-making function
    in every admin*.py script routes through this instead of each
    duplicating its own `if not response.ok: raise RuntimeError(...)`.
    Two things this centralizes:

    1. A 401 specifically raises SessionExpired, not a plain
       RuntimeError - see that class's docstring for why the
       distinction matters.
    2. Falls back to `data.get("msg")` as well as `data.get("error")` -
       every route THIS app writes itself uses `error`, but
       flask_jwt_extended's OWN built-in error responses (expired
       token, revoked token, missing fresh token) use `msg` instead.
       Without this, those specific failures showed a generic
       fallback message instead of their own real, more useful reason
       ("Token has been revoked", "Fresh token required", etc).

    Returns the parsed JSON body on success (2xx)."""
    data = response.json()
    if response.status_code == 401:
        raise SessionExpired(data.get("error") or data.get("msg") or "Session expired - please log in again")
    if not response.ok:
        raise RuntimeError(data.get("error") or data.get("msg") or fallback_message)
    return data


def fetch_me(token):
    """Whoever `token` belongs to: username, role name, level, and
    effective permission set (role bundle + any per-user overrides
    already applied - see permissions.py's get_user_role_and_permissions
    on the backend). Used by admin_login_prompt() below to decide
    whether these tools are even worth entering, and by the various
    run_X() actions to only offer options the caller's own permissions
    actually allow - though the backend remains the real authority on
    every individual action regardless of what the CLI chooses to show."""
    response = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    return check_response(response, "Failed to fetch account info")


def fetch_users(token):
    """Every user with their role name/level and effective permissions -
    powers listUsersAdmin.py and the picker in assignRoleAdmin.py /
    managePermissionsAdmin.py."""
    response = requests.get(
        f"{BASE_URL}/admin/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch users")
    return data["users"]


def fetch_roles(token):
    """Every role with its level and bundled permission keys - powers
    the role picker in assignRoleAdmin.py and manageRolesAdmin.py."""
    response = requests.get(
        f"{BASE_URL}/admin/roles",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch roles")
    return data["roles"]


def fetch_permissions(token):
    """The full master list of permission keys that exist anywhere in
    the app (schema.sql's permissions table) - powers the checklist in
    manageRolesAdmin.py and managePermissionsAdmin.py. Adding a brand
    new permission later needs no change here; this always reflects
    whatever the backend currently knows about."""
    response = requests.get(
        f"{BASE_URL}/admin/permissions",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch permissions")
    return data["permissions"]


def choose_from_list(items, label_fn, prompt="Choose", allow_blank=True):
    """Generic numbered picker - shows label_fn(item) for each item,
    returns the chosen item or None on blank input. Used by the new
    user/role/permission-management scripts instead of each one
    reimplementing its own numbered-list loop (adminCliCommon.py's
    older choose_category() is the same idea, kept separate since it
    returns a plain name string rather than a full item - some callers
    genuinely only ever needed the name)."""
    print()
    for i, item in enumerate(items, start=1):
        print(f"  {i}. {label_fn(item)}")
    print()

    while True:
        choice = input(f"{prompt} (number{', or blank to cancel' if allow_blank else ''}): ").strip()
        if not choice and allow_blank:
            return None
        if not choice.isdigit() or not (1 <= int(choice) <= len(items)):
            print(f"Enter a number from 1 to {len(items)}.\n")
            continue
        return items[int(choice) - 1]


def choose_multiple_permissions(all_permissions, preselected=None):
    """Interactive checklist: toggle permission keys on/off by number,
    'A' to select everything currently shown, 'N' to clear all, blank
    to confirm the current selection. Used anywhere a script needs a
    SET of permissions rather than one single pick (creating/editing a
    role's bundle) - the single-pick choose_from_list() above isn't the
    right shape for that.

    `preselected` (a set of keys, or None) seeds the initial selection -
    editing an existing role's permissions should start from what it
    already has, not from empty every time."""
    selected = set(preselected or [])

    while True:
        print("\nPermissions (toggle by number, A = select all, N = none, blank/Enter = done):\n")
        for i, perm in enumerate(all_permissions, start=1):
            mark = "x" if perm["key"] in selected else " "
            print(f"  [{mark}] {i}. {perm['key']} - {perm['description']}")
        print()

        choice = input("Toggle (number/A/N), or blank to confirm: ").strip()
        if not choice:
            return selected
        if choice.lower() == "a":
            selected = {p["key"] for p in all_permissions}
            continue
        if choice.lower() == "n":
            selected = set()
            continue
        if choice.isdigit() and 1 <= int(choice) <= len(all_permissions):
            key = all_permissions[int(choice) - 1]["key"]
            if key in selected:
                selected.discard(key)
            else:
                selected.add(key)
            continue
        print(f"Enter a number from 1 to {len(all_permissions)}, A, N, or blank.\n")


def revoke_token(token, jti):
    """POST /admin/tokens/revoke - kills one specific token by its jti,
    regardless of how much of its natural expiry window is left. Used
    to end an impersonation session early (see impersonateUserAdmin.py
    and manageUserTransactionsAdmin.py, both of which offer this right
    after finishing) rather than letting it sit valid for the rest of
    its (short, but non-zero) 15-minute window."""
    response = requests.post(
        f"{BASE_URL}/admin/tokens/revoke",
        headers={"Authorization": f"Bearer {token}"},
        json={"jti": jti},
    )
    return check_response(response, "Revoke failed")


def fetch_impersonation_log(token):
    """GET /admin/impersonation-log - every impersonation ever
    performed (actor, target, jti, when), newest first. Powers
    listImpersonationLogAdmin.py. Requires the 'audit.view' permission,
    NOT bundled into 'admin' by default - see schema.sql."""
    response = requests.get(
        f"{BASE_URL}/admin/impersonation-log",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch impersonation log")
    return data["log"]


def fetch_transactions(token):
    """GET /transactions for whoever `token` belongs to. This is a
    plain per-user endpoint (jwt_required only, no special permission
    gate) - passing an IMPERSONATED user's token here returns THEIR
    transaction history, exactly as if they'd opened the app
    themselves. Used by manageUserTransactionsAdmin.py."""
    response = requests.get(
        f"{BASE_URL}/transactions",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = check_response(response, "Failed to fetch transactions")
    return data["transactions"]


def delete_transactions(token, ids):
    """DELETE /transactions for whoever `token` belongs to. Same
    "acts as whoever the token is" pattern as fetch_transactions above -
    passing an impersonated token deletes THAT user's transactions,
    scoped server-side by their own user_id, same as the app itself."""
    response = requests.delete(
        f"{BASE_URL}/transactions",
        headers={"Authorization": f"Bearer {token}"},
        json={"ids": ids},
    )
    data = check_response(response, "Delete failed")
    return data["deleted"]


def resolve_categories(token, resolutions):
    """POST /categorize/resolve for whoever `token` belongs to - the
    same endpoint ContentsScreen.js's handleCategoryPick() calls for
    BOTH "pick a category for something that needs manual review" and
    "change an already-categorised transaction's category" - the app
    itself doesn't distinguish these as different backend actions, so
    neither does this. Returns {'updated': [...], 'skipped': [...]}."""
    response = requests.post(
        f"{BASE_URL}/categorize/resolve",
        headers={"Authorization": f"Bearer {token}"},
        json={"resolutions": resolutions},
    )
    return check_response(response, "Resolve failed")


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def color_swatch(hex_color, width=4):
    """Returns a small block of that actual colour, rendered via 24-bit
    ANSI escape codes - supported by basically every modern terminal
    (iTerm2, Windows Terminal, VS Code's integrated terminal, GNOME
    Terminal, macOS Terminal.app). Degrades harmlessly on anything that
    doesn't support it - worst case it just shows as blank space, the
    hex text printed alongside it is unaffected either way."""
    try:
        r, g, b = hex_to_rgb(hex_color)
        return f"\033[48;2;{r};{g};{b}m{' ' * width}\033[0m"
    except (ValueError, IndexError):
        return ' ' * width


# Same palette as COLOR_PALETTE in App/utils/charts/chartUtils.js - kept
# in sync manually since these are standalone scripts, not a shared
# import with the app itself. If that palette changes, update this too.
COLOR_PALETTE = [
    '#2E5C8A', '#E07A3E', '#3D8B5F', '#9B3D8A', '#C4A227',
    '#D94F4F', '#4FA8D9', '#7A5C3D', '#5C8A2E', '#D97AB8',
    '#3D5C8A', '#8A3D3D', '#4DBFBF', '#A67C52',
]


def color_distance(hex1, hex2):
    """Simple Euclidean distance in RGB space (0 = identical,
    ~441 = furthest apart, black vs white). Not a true perceptual
    colour-distance model, but good enough to tell "basically the same
    colour" apart from "clearly different" for generation purposes."""
    r1, g1, b1 = hex_to_rgb(hex1)
    r2, g2, b2 = hex_to_rgb(hex2)
    return ((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) ** 0.5


def generate_random_colors(count, avoid=None, min_distance=45):
    """Generates `count` random hex colours, mutually distinct from
    each other and (if given) from everything in `avoid`, by at least
    `min_distance` in RGB space.

    Deliberately NOT pure random RGB (random.randint 3 times) - that
    produces a lot of muddy, near-grey, or unreadably dark/light
    results. Random HUE with constrained saturation/lightness ranges
    gives vibrant, legible swatches every time, which is what you
    actually want for chart segment colours.
    """
    import colorsys
    import random

    avoid = list(avoid or [])
    results = []

    for _ in range(count):
        candidate = None
        # Capped attempts so a huge/impossible avoid list can't hang
        # forever - falls back to the last candidate tried rather than
        # silently returning fewer colours than asked for.
        for _attempt in range(200):
            h = random.random()
            s = random.uniform(0.55, 0.85)
            l = random.uniform(0.40, 0.62)
            r, g, b = colorsys.hls_to_rgb(h, l, s)
            candidate = '#{:02X}{:02X}{:02X}'.format(
                round(r * 255), round(g * 255), round(b * 255)
            )
            too_close = any(
                color_distance(candidate, other) < min_distance
                for other in avoid + results
            )
            if not too_close:
                break
        results.append(candidate)

    return results


def _confirm_pick(candidate, existing=None, old_color=None, old_color_name=None):
    """Shared confirmation step for EVERY colour-picking path (palette,
    custom hex, random batch) - shows the full stack of colours
    currently in use, what the specific thing being changed USED to
    be, and what it's ABOUT to become, then asks to confirm. Returns
    True/False; nothing is applied here, this is purely display +
    confirmation, the actual API call happens in the calling script
    only if this returns True.

    `existing` (list of category dicts) and `old_color` (hex string)
    are both optional and independent of each other - `existing` is
    "everything currently in use, across all categories" (the general
    reference stack); `old_color` is specifically "what THIS ONE
    category was before this change" (there's no such thing when
    adding a brand new category, which is why auto_generate_unique_color()
    doesn't use this - a new category doesn't have an "old" colour).
    `old_color_name`, if given, is that category's name - shown
    alongside the old colour so it's clear WHOSE old colour it was,
    not just an unlabelled hex value."""
    if existing:
        print("\nCurrently in use:")
        for c in existing:
            print(f"  {color_swatch(c['color'])} {c['color']} - {c['name']}")

    print()
    if old_color:
        name_part = f" ({old_color_name})" if old_color_name else ""
        print(f"  Old: {color_swatch(old_color)} {old_color}{name_part}")
    print(f"  New: {color_swatch(candidate)} {candidate}")
    print()

    return input("Use this colour? (y/n): ").strip().lower() == "y"


def _choose_from_random_batch(existing, old_color=None, old_color_name=None):
    """The random-generation sub-flow: ask whether to avoid colours
    already in use, ask how many to generate (defaulting to the
    category count), then show a fresh batch every time (including on
    regenerate). Picking one runs it through the same _confirm_pick()
    every other path uses - stack, old colour, new colour, confirm -
    rather than its own separate confirmation step. Lets the admin
    regenerate, pick one, or cancel back to the main colour menu
    (returns None).

    `existing` is the full list of category dicts (name + color) from
    fetch_categories_full() - not just a flat list of hex strings -
    specifically so the comparison display can show which category
    each existing colour belongs to, not just an unlabelled swatch."""
    existing = existing or []
    existing_colors = [c["color"] for c in existing]

    avoid = []
    if existing_colors:
        ans = input(
            f"Avoid the {len(existing_colors)} colour(s) already used by "
            f"your categories? (y/n): "
        ).strip().lower()
        if ans == "y":
            avoid = existing_colors

    default_count = len(existing_colors) if existing_colors else 15
    while True:
        raw = input(f"How many random options? (Enter for {default_count}): ").strip()
        if not raw:
            count = default_count
            break
        if raw.isdigit() and int(raw) > 0:
            count = int(raw)
            break
        print("Enter a positive number, or leave blank for the default.\n")

    while True:
        batch = generate_random_colors(count, avoid=avoid)

        # Shown every time a batch is (re)generated, not just at the
        # final confirm step - the whole point is comparing options
        # WHILE browsing/regenerating, not just once after you've
        # already committed to a number.
        if existing:
            print("\nCurrently in use:")
            for c in existing:
                print(f"  {color_swatch(c['color'])} {c['color']} - {c['name']}")
        if old_color:
            name_part = f" ({old_color_name})" if old_color_name else ""
            print(f"\n  Old: {color_swatch(old_color)} {old_color}{name_part}")

        print("\nNew options:")
        for i, color in enumerate(batch, start=1):
            print(f"  {i}. {color_swatch(color)} {color}")
        print(f"  R. Regenerate a fresh batch of {count}")
        print(f"  Q. Cancel, back to the colour menu")
        print()

        pick = input("Pick a colour (number), R, or Q: ").strip().lower()
        if pick == "q":
            return None
        if pick == "r":
            continue
        if pick.isdigit() and 1 <= int(pick) <= len(batch):
            chosen = batch[int(pick) - 1]
            if _confirm_pick(chosen, existing=existing, old_color=old_color, old_color_name=old_color_name):
                return chosen
            print("OK, back to this batch.\n")
            continue
        print(f"Enter a number from 1 to {len(batch)}, R, or Q.\n")


def auto_generate_unique_color(existing_colors):
    """No menu, no palette, no "would you like to avoid existing
    colours" question - just generates one random colour that's
    already guaranteed distinct from everything in `existing_colors`,
    shows it, and asks to confirm. Says no and it just generates
    another one - loops until you accept.

    Deliberately separate from choose_color(): that function is the
    full picker (palette / custom hex / random-with-options) used by
    the tools that are RECOLOURING an existing category, where you
    might genuinely want a specific known colour. Adding a brand new
    category doesn't have that same need - a fresh, non-clashing
    colour picked for you IS the point, not one option among many."""
    while True:
        color = generate_random_colors(1, avoid=existing_colors)[0]
        print(f"  {color_swatch(color)} {color}")
        confirm = input("Use this colour? (y/n): ").strip().lower()
        if confirm == "y":
            return color
        print("Generating another...\n")


def choose_color(existing=None, old_color=None, old_color_name=None):
    """Prints the standard palette (with swatches), plus a "type a
    custom hex" option and a "generate random colours" option, and
    returns whichever hex string was chosen. Shared by every tool that
    needs to pick a new colour for something - set-color,
    set-default-color, set-both (add-category has its own, simpler,
    no-menu auto_generate_unique_color() instead - see that function's
    docstring for why).

    Every path through this function - palette, custom hex, random
    batch - ends at the SAME confirmation step (_confirm_pick): shows
    the full stack of colours currently in use, what this specific
    thing used to be, and what it's about to become, before anything
    is actually returned. Saying no just brings you back to wherever
    you were picking from, nothing is ever applied without an explicit
    yes.

    `existing`, if given, is the full list of category dicts (as
    returned by fetch_categories_full() - name + color) currently in
    the app - shown as the comparison stack. `old_color`, if given, is
    specifically what the thing being changed used to be (there's no
    such thing when adding a brand new category); `old_color_name` is
    that category's name, shown alongside it. Callers that don't have
    any of these handy can omit them; picking still works, there's
    just less to compare against."""
    n_custom = len(COLOR_PALETTE) + 1
    n_random = len(COLOR_PALETTE) + 2

    while True:
        print()
        for i, color in enumerate(COLOR_PALETTE, start=1):
            print(f"  {i}. {color_swatch(color)} {color}")
        print(f"  {n_custom}. Type a custom hex colour")
        print(f"  {n_random}. Generate random colour options")
        print()

        choice = input("Colour (number): ").strip()
        if not choice.isdigit():
            print("Enter a number.\n")
            continue
        n = int(choice)
        if 1 <= n <= len(COLOR_PALETTE):
            candidate = COLOR_PALETTE[n - 1]
            if _confirm_pick(candidate, existing=existing, old_color=old_color, old_color_name=old_color_name):
                return candidate
            continue  # back to the full menu
        if n == n_custom:
            # Own inner loop, deliberately separate from the outer
            # menu loop above - a bad format or saying "no" to the
            # confirm should both just re-ask for the hex again, not
            # dump you back to picking a number from the palette menu.
            # That was the actual bug this used to have: every
            # `continue` in here used to jump back to the OUTER loop's
            # "Colour (number):" prompt, which only accepts a menu
            # number - so retyping a hex value there just kept failing
            # with "Enter a number." with no way out except restarting
            # the whole picker from scratch.
            while True:
                custom = input("Hex colour (e.g. #3D8B5F), or blank to go back: ").strip()
                if not custom:
                    break  # back to the outer menu (palette + option list)
                if not custom.startswith('#') or len(custom) != 7:
                    print("Must look like #RRGGBB.\n")
                    continue
                try:
                    hex_to_rgb(custom)
                except ValueError:
                    print("That's not a valid hex colour (letters must be 0-9/A-F).\n")
                    continue

                if _confirm_pick(custom, existing=existing, old_color=old_color, old_color_name=old_color_name):
                    return custom
                print("OK, try again.\n")
            continue
        if n == n_random:
            result = _choose_from_random_batch(existing, old_color=old_color, old_color_name=old_color_name)
            if result is not None:
                return result
            continue  # cancelled back to this same menu
        print(f"Enter a number from 1 to {n_random}.\n")


def choose_category(categories, prompt="Category"):
    """Prints a numbered list and returns the chosen name, or None if
    the user backs out (blank input). Used anywhere a script needs to
    pick exactly ONE category by number - rename and delete both use
    this as-is; combine has its own choose_categories() (plural, picks
    several distinct ones) since that's a different shape of prompt."""
    print()
    for i, name in enumerate(categories, start=1):
        print(f"  {i}. {name}")
    print()

    while True:
        choice = input(f"{prompt} (number, or blank to cancel): ").strip()
        if not choice:
            return None
        if not choice.isdigit() or not (1 <= int(choice) <= len(categories)):
            print(f"Enter a number from 1 to {len(categories)}.\n")
            continue
        return categories[int(choice) - 1]


def admin_login_prompt():
    """Standard login prompt used by every script's standalone
    __main__ entry point - asks for username/password, logs in, and
    returns the token (or None if login didn't happen or the account
    has no elevated access at all, in which case the caller should just
    return without doing anything further).

    Used to hardcode "username must literally be 'admin'" as a local
    safety net before the permission system existed - now that roles
    and permissions are real, that check would actively be WRONG: it
    would lock out a legitimately-promoted admin whose username isn't
    "admin", while doing nothing to stop someone who somehow still had
    the literal "admin" account but had since been demoted. The real
    check is now "does this account have any elevated access at all" -
    a plain 'user' (level 0, no permissions, no overrides) is turned
    away here since there's nothing in this whole tool suite they could
    do anyway; anyone above that gets in, and each individual action
    still gets its own specific permission check server-side regardless
    of what this entry gate decided.
    """
    username = input("Username: ").strip()
    import getpass
    password = getpass.getpass("Password: ")

    try:
        token = login(username, password)
    except Exception as e:
        print(f"Login failed: {e}")
        return None

    try:
        me = fetch_me(token)
    except Exception as e:
        print(f"Logged in, but couldn't check account permissions: {e}")
        return None

    if me["level"] <= 0 and not me["permissions"]:
        print("This account has no elevated permissions - nothing in this tool suite applies to it.")
        return None

    print(f'Logged in as "{me["username"]}" ({me["role"]}, level {me["level"]}).\n')
    return token
