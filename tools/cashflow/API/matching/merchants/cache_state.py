"""
matching/merchants/cache_state.py

Process-level caching for the merchant dictionary: the raw normalised
merchant dict, the Aho-Corasick automaton built over it, and the word-
overlap index used for the fuzzy fallback. All three share the same
lifecycle - invalidated together whenever a merchant is added/changed.
"""

import threading

import ahocorasick

from ..fuzzy_index import build_word_index

_global_merchants_cache = None
_global_merchant_automaton_cache = None
_global_merchant_word_index_cache = None
# gunicorn runs with --threads, so these lazy builds can race: two requests
# would both rebuild the automaton, or one would read it mid-invalidation.
_cache_lock = threading.RLock()


def get_global_merchants_cache():
    """Returns the current in-memory merchants dict, or None if never
    loaded yet. Used by storage.py to check/update it in place."""
    return _global_merchants_cache


def set_global_merchants_cache(normalised_merchants):
    global _global_merchants_cache
    with _cache_lock:
        _global_merchants_cache = normalised_merchants


def get_merchant_automaton(normalised_merchants: dict):
    """Builds (once, cached at process level) an Aho-Corasick automaton
    over every merchant name -> (name, category) pair.
    """
    global _global_merchant_automaton_cache
    with _cache_lock:
        if _global_merchant_automaton_cache is not None:
            return _global_merchant_automaton_cache

        automaton = ahocorasick.Automaton()
        for merchant_name, category in list(normalised_merchants.items()):
            if merchant_name:
                automaton.add_word(merchant_name, (merchant_name, category))
        automaton.make_automaton()
        _global_merchant_automaton_cache = automaton
        print(
            f"[merchant automaton] COLD BUILD: {len(normalised_merchants)} merchant name(s)",
            flush=True,
        )
        return automaton


def get_merchant_word_index(normalised_merchants: dict):
    global _global_merchant_word_index_cache
    with _cache_lock:
        if _global_merchant_word_index_cache is not None:
            return _global_merchant_word_index_cache

        merchant_names_list = list(normalised_merchants.keys())
        word_index, short_indices = build_word_index(merchant_names_list)
        _global_merchant_word_index_cache = (merchant_names_list, word_index, short_indices)
        return _global_merchant_word_index_cache


def invalidate_merchant_automaton():
    """Called whenever the merchant dictionary changes (add_merchant) -
    forces the next get_merchant_automaton() / get_merchant_word_index()
    call to rebuild from the current (already-patched) merchants cache.
    """
    global _global_merchant_automaton_cache, _global_merchant_word_index_cache
    with _cache_lock:
        _global_merchant_automaton_cache = None
        _global_merchant_word_index_cache = None