#!/usr/bin/env python3
"""
Scale-test data generator for Boast (SquashLevel).

Generates:
  - 1,000 players across 20 global cities (clubs sized to city)
  - 50,000 matches with realistic uneven activity distribution
  - 100 themed groups (5–100 members each, no city bias)

Player ratings span 1K–100K with exponential decay (most players low-rated,
few elite). Opponents are skill-matched within ±max(5000, 30%) of own rating.

Output: fixtures/scale-test-1k.json

Usage:
    python fixtures/generate_scale_data.py

No external dependencies — uses only the Python standard library.
"""

import bisect
import itertools
import json
import math
import os
import random
import uuid
from datetime import date, timedelta

# ── Configuration ──────────────────────────────────────────────────────────────
TOTAL_PLAYERS    = 1_000
TOTAL_MATCHES    = 50_000
TOTAL_GROUPS     = 100

PLAYERS_PER_CLUB = 10           # target — clubs per city = round(city_players / 10)
MONTHS           = 60           # 5 years of match history
SAME_CLUB_PROB   = 0.70
SAME_CITY_PROB   = 0.20
# remaining 0.10 → any city

# Rating distribution: exponential decay, mean ≈ 12K, clipped to [1K, 100K]
RATING_MIN       = 1_000
RATING_MAX       = 100_000
RATING_SCALE     = 11_000       # exponential scale; rating = MIN + expo(1/SCALE)

# Skill-matched opponents: pool restricted to within ±max(ABS_BAND, REL_BAND%) of own rating
RATING_BAND_REL  = 0.30
RATING_BAND_ABS  = 5_000

# Activity distribution (matches per player) — Pareto for realistic 80/20 skew
ACTIVITY_ALPHA   = 1.16

START_DATE  = date(2021, 5, 9)
END_DATE    = date(2026, 5, 9)
TOTAL_DAYS  = (END_DATE - START_DATE).days

MATCH_TYPES   = ['friendly', 'box', 'league', 'tournament']
MATCH_WEIGHTS = [0.50,       0.30,  0.15,     0.05]

GROUP_MIN_MEMBERS = 5
GROUP_MAX_MEMBERS = 100

OUTPUT = os.path.join(os.path.dirname(__file__), 'scale-test-1k.json')
SEED   = 42  # fixed seed → reproducible dataset

# ── Cities ─────────────────────────────────────────────────────────────────────
# weight ≈ relative number of players (squash-active hubs weighted higher)
CITIES = [
    {'name': 'London',        'country': 'GB', 'weight': 12},
    {'name': 'New York',      'country': 'US', 'weight': 10},
    {'name': 'Mumbai',        'country': 'IN', 'weight':  9},
    {'name': 'Cairo',         'country': 'EG', 'weight':  9},
    {'name': 'Dubai',         'country': 'AE', 'weight':  8},
    {'name': 'Hong Kong',     'country': 'HK', 'weight':  7},
    {'name': 'Karachi',       'country': 'PK', 'weight':  6},
    {'name': 'Kuala Lumpur',  'country': 'MY', 'weight':  5},
    {'name': 'Toronto',       'country': 'CA', 'weight':  5},
    {'name': 'Sydney',        'country': 'AU', 'weight':  5},
    {'name': 'Singapore',     'country': 'SG', 'weight':  4},
    {'name': 'Melbourne',     'country': 'AU', 'weight':  4},
    {'name': 'Paris',         'country': 'FR', 'weight':  4},
    {'name': 'Manchester',    'country': 'GB', 'weight':  3},
    {'name': 'Boston',        'country': 'US', 'weight':  3},
    {'name': 'Chicago',       'country': 'US', 'weight':  3},
    {'name': 'Johannesburg',  'country': 'ZA', 'weight':  3},
    {'name': 'Auckland',      'country': 'NZ', 'weight':  2},
    {'name': 'Amsterdam',     'country': 'NL', 'weight':  2},
    {'name': 'Madrid',        'country': 'ES', 'weight':  1},
]

FIRST_NAMES: dict[str, list[str]] = {
    'GB': ['James', 'Oliver', 'Harry', 'Jack', 'George', 'Charlie', 'Emma', 'Olivia', 'Sophie',
           'Isla', 'Amir', 'Hassan', 'Priya', 'Liam', 'Noah', 'Amelia', 'Mia', 'Imogen'],
    'US': ['James', 'Liam', 'Noah', 'Oliver', 'Elijah', 'Ava', 'Emma', 'Charlotte', 'Mia',
           'Marcus', 'Tyler', 'Jordan', 'Taylor', 'Morgan', 'Mason', 'Sophia', 'Logan'],
    'AE': ['Mohammed', 'Ahmed', 'Ali', 'Omar', 'Khalid', 'Fatima', 'Aisha', 'Layla', 'Sara',
           'Reem', 'Yusuf', 'Hamza', 'Noor', 'Ziad', 'Mariam', 'Sultan', 'Hessa', 'Noora'],
    'IN': ['Arjun', 'Rohan', 'Vikram', 'Rahul', 'Aditya', 'Priya', 'Ananya', 'Sneha', 'Riya',
           'Kavya', 'Nikhil', 'Karan', 'Pooja', 'Neha', 'Siddharth', 'Ishaan', 'Divya'],
    'EG': ['Ahmed', 'Mohamed', 'Omar', 'Khaled', 'Tarek', 'Fatma', 'Nour', 'Hana', 'Mariam',
           'Dina', 'Amr', 'Mostafa', 'Yasmine', 'Rana', 'Salma', 'Karim', 'Nada'],
    'HK': ['Wei', 'Fang', 'Min', 'Jing', 'Hao', 'Mei', 'Xiu', 'Ying', 'Jun',
           'Kai', 'Ling', 'Chen', 'Hong', 'Feng', 'Zhen', 'Qiang', 'Xin'],
    'PK': ['Ali', 'Hassan', 'Hamza', 'Bilal', 'Usman', 'Imran', 'Faisal', 'Ayesha', 'Fatima',
           'Sana', 'Hina', 'Maria', 'Zara', 'Ahsan', 'Zain', 'Saad', 'Anum', 'Rabia'],
    'MY': ['Ahmad', 'Aiman', 'Hafiz', 'Faiz', 'Adam', 'Nur', 'Aishah', 'Siti', 'Farah',
           'Wei', 'Jing', 'Mei', 'Raj', 'Priya', 'Arjun', 'Hui', 'Lim', 'Aina'],
    'CA': ['Liam', 'Noah', 'Oliver', 'Ethan', 'Lucas', 'Emma', 'Olivia', 'Charlotte',
           'Ava', 'Sofia', 'Aiden', 'Mason', 'Sophia', 'Mia', 'Arjun', 'Mei'],
    'AU': ['Jack', 'Oliver', 'Noah', 'William', 'Ethan', 'Olivia', 'Charlotte', 'Amelia',
           'Isla', 'Mia', 'Lucas', 'Liam', 'Ava', 'Grace', 'Henry', 'Thomas'],
    'SG': ['Wei', 'Jing', 'Hui', 'Mei', 'Rajan', 'Priya', 'Arjun', 'Farah',
           'Ahmad', 'Siti', 'Kai', 'Min', 'Ling', 'Raj', 'Zhen', 'Nurul'],
    'FR': ['Lucas', 'Hugo', 'Louis', 'Gabriel', 'Adam', 'Léo', 'Emma', 'Louise', 'Chloé',
           'Manon', 'Camille', 'Alice', 'Antoine', 'Mathieu', 'Pierre', 'Julie', 'Marie'],
    'ZA': ['Thabo', 'Sipho', 'Lebo', 'Nkosi', 'Bongani', 'Nandi', 'Zanele', 'Ayanda',
           'Thembi', 'Nomsa', 'Khaya', 'Siyanda', 'Lindiwe', 'Mpho', 'Lerato', 'Kabelo'],
    'NZ': ['Jack', 'Noah', 'Oliver', 'Liam', 'William', 'Charlotte', 'Olivia', 'Mia',
           'Ava', 'Isla', 'Tane', 'Manaia', 'Aroha', 'Mereana', 'Wiremu', 'Hemi'],
    'NL': ['Daan', 'Sem', 'Lucas', 'Finn', 'Bram', 'Emma', 'Sophie', 'Julia', 'Anna',
           'Lieke', 'Thomas', 'Max', 'Tess', 'Sara', 'Luuk', 'Mees'],
    'ES': ['Hugo', 'Mateo', 'Daniel', 'Pablo', 'Álvaro', 'Lucía', 'Sofía', 'Martina',
           'María', 'Carmen', 'Diego', 'Adrián', 'Paula', 'Valeria', 'Javier', 'Alejandro'],
}

LAST_NAMES: dict[str, list[str]] = {
    'GB': ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Wilson', 'Evans',
           'Thomas', 'Roberts', 'Khan', 'Patel', 'Shah', 'Ahmed', 'Begum'],
    'US': ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
           'Wilson', 'Anderson', 'Jackson', 'Lee', 'Harris', 'Martin', 'Thompson'],
    'AE': ['Al-Maktoum', 'Al-Nahyan', 'Hassan', 'Ahmed', 'Ali', 'Omar', 'Khalid', 'Rashid',
           'Saeed', 'Mohammed', 'Abdullah', 'Ibrahim', 'Al-Mansoori', 'Al-Hashemi'],
    'IN': ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Mehta', 'Joshi', 'Reddy',
           'Nair', 'Verma', 'Agarwal', 'Rao', 'Pillai', 'Iyer', 'Chatterjee'],
    'EG': ['Hassan', 'Ahmed', 'Mohamed', 'Ali', 'Ibrahim', 'Mahmoud', 'Khalil', 'Farouk',
           'Saleh', 'Nasser', 'Mansour', 'Saad', 'El-Sayed', 'Abdel-Rahman'],
    'HK': ['Chan', 'Lee', 'Wong', 'Lau', 'Cheung', 'Ng', 'Ma', 'Ho',
           'Yip', 'Tam', 'Liu', 'Cheng', 'Leung', 'Kwok', 'Lam'],
    'PK': ['Khan', 'Ahmed', 'Ali', 'Hussain', 'Malik', 'Sheikh', 'Raza', 'Iqbal',
           'Siddiqui', 'Qureshi', 'Butt', 'Chaudhry', 'Rashid', 'Mahmood'],
    'MY': ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chan', 'Goh', 'Ong', 'Abdullah',
           'Ibrahim', 'Ismail', 'Yusoff', 'Hassan', 'Rahman', 'Kumar', 'Singh'],
    'CA': ['Smith', 'Brown', 'Tremblay', 'Martin', 'Roy', 'Wilson', 'MacDonald', 'Taylor',
           'Johnson', 'Lee', 'Nguyen', 'Singh', 'Patel', 'Kim', 'Chen'],
    'AU': ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White',
           'Martin', 'Anderson', 'Thompson', 'Lee', 'Harris', 'Scott', 'Young'],
    'SG': ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chan', 'Goh', 'Ong',
           'Kumar', 'Singh', 'Rahman', 'Abdullah', 'Yeo', 'Chua', 'Koh'],
    'FR': ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand',
           'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia'],
    'ZA': ['Dlamini', 'Nkosi', 'Ndlovu', 'Zulu', 'Mthembu', 'Khumalo', 'Sithole', 'Mkhize',
           'Cele', 'Buthelezi', 'Molefe', 'Smith', 'Botha', 'Van der Merwe', 'Mokoena'],
    'NZ': ['Smith', 'Wilson', 'Williams', 'Brown', 'Taylor', 'Anderson', 'Walker', 'Thompson',
           'Ngata', 'Tane', 'Te Kanawa', 'Wiremu', 'Mason', 'Clarke', 'Hall'],
    'NL': ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Visser',
           'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos'],
    'ES': ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez',
           'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz'],
}

CLUB_PREFIXES = [
    'Royal', 'City', 'Metropolitan', 'Premier', 'Elite', 'Champions',
    'Grand', 'Central', 'United', 'Classic', 'Diamond', 'Golden',
    'Silver', 'Prestige', 'Heritage', 'National', 'International',
    'Capital', 'Harbour', 'Tower',
]
CLUB_SUFFIXES = [
    'Squash Club', 'Racquet Club', 'Sports Club', 'Athletic Club',
    'Squash Academy', 'Squash Centre', 'Rackets Club', 'Squash & Fitness',
    'Sporting Club', 'Fitness Club',
]

EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'proton.me', 'icloud.com', 'sports.net', 'squash.io',
]

# ── Group naming ───────────────────────────────────────────────────────────────
GROUP_TIME_PREFIX = [
    'Friday Night', 'Saturday Morning', 'Sunday Brunch', 'Monday', 'Tuesday',
    'Wednesday', 'Thursday', 'Weekend', 'Early Bird', 'Lunch Break',
    'After Work', 'Late Night', 'Dawn',
]
GROUP_NOUN = [
    'Squash', 'Racquets', 'Smashers', 'Aces', 'Volleys', 'Drives', 'Hitters',
    'Crew', 'Gang', 'Squad', 'League', 'Society', 'Brigade', 'Posse',
    'Warriors', 'Pros', 'Regulars', 'Globetrotters', 'Misfits', 'Hustlers',
]
GROUP_QUALIFIER = [
    'Champions', 'Legends', 'Veterans', 'Rookies', 'Misfits', 'Regulars',
    'Locals', 'Old Boys', 'Young Guns', 'All-Stars',
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def new_id() -> str:
    return str(uuid.uuid4())


def random_game(rng: random.Random, a_win_prob: float) -> dict:
    """One squash game score; winner gets 11 (or more on deuce)."""
    a_wins = rng.random() < a_win_prob
    loser  = rng.randint(0, 9)
    if loser == 9 and rng.random() < 0.3:
        extra  = rng.randint(1, 3) * 2
        winner = 11 + extra
        loser  = 9 + extra
    else:
        winner = 11
    return {'a': winner, 'b': loser} if a_wins else {'a': loser, 'b': winner}


def random_match_games(rng: random.Random, level_diff: int) -> list[dict]:
    """Best-of-5 games; level_diff > 0 means player A is stronger."""
    win_prob = 0.5 + min(0.30, max(-0.30, level_diff / 80_000))
    games, a_sets, b_sets = [], 0, 0
    while a_sets < 3 and b_sets < 3:
        g = random_game(rng, win_prob)
        games.append(g)
        if g['a'] > g['b']:
            a_sets += 1
        else:
            b_sets += 1
    return games


def iso_date(d: date) -> str:
    return d.isoformat()


def club_name(city_name: str, idx: int) -> str:
    return f"{city_name} {CLUB_PREFIXES[idx % len(CLUB_PREFIXES)]} {CLUB_SUFFIXES[idx % len(CLUB_SUFFIXES)]}"


def fake_email(first: str, last: str, domain: str, disambig: int) -> str:
    f = first.lower().replace(' ', '').replace('-', '').replace('é', 'e').replace('í', 'i').replace('á', 'a').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
    l = last.lower().replace(' ', '').replace('-', '').replace('é', 'e').replace('í', 'i').replace('á', 'a').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
    return f'{f}.{l}{disambig}@{domain}'


def sample_rating(rng: random.Random) -> int:
    """Exponential decay in [RATING_MIN, RATING_MAX], mean ≈ RATING_MIN + RATING_SCALE."""
    while True:
        x = RATING_MIN + rng.expovariate(1.0 / RATING_SCALE)
        if x <= RATING_MAX:
            return int(x)


def rating_band(rating: int) -> int:
    return max(RATING_BAND_ABS, int(RATING_BAND_REL * rating))


def slugify(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != '-':
            out.append('-')
    return ''.join(out).strip('-')


def random_group_name(rng: random.Random) -> str:
    style = rng.randint(0, 4)
    if style == 0:
        return f"{rng.choice(GROUP_TIME_PREFIX)} {rng.choice(GROUP_NOUN)}"
    if style == 1:
        return f"{rng.choice(GROUP_NOUN)} {rng.choice(GROUP_QUALIFIER)}"
    if style == 2:
        return f"The {rng.choice(GROUP_QUALIFIER)}"
    if style == 3:
        age = rng.choice([30, 35, 40, 45, 50, 55])
        cmp = rng.choice(['Over', 'Under'])
        return f"{cmp}-{age} {rng.choice(GROUP_NOUN)}"
    return f"{rng.choice(GROUP_TIME_PREFIX)} {rng.choice(GROUP_QUALIFIER)}"


# ── Main generation ────────────────────────────────────────────────────────────

def main() -> None:
    rng = random.Random(SEED)

    # ── 1. Distribute players across cities by weight ──────────────────────────
    total_w = sum(c['weight'] for c in CITIES)
    raw    = [c['weight'] / total_w * TOTAL_PLAYERS for c in CITIES]
    counts = [max(5, int(round(x))) for x in raw]
    # adjust to hit exactly TOTAL_PLAYERS — add/remove from largest cities
    diff = TOTAL_PLAYERS - sum(counts)
    order_by_size = sorted(range(len(CITIES)), key=lambda i: -counts[i])
    i = 0
    while diff != 0:
        idx = order_by_size[i % len(order_by_size)]
        if diff > 0:
            counts[idx] += 1
            diff -= 1
        elif counts[idx] > 5:
            counts[idx] -= 1
            diff += 1
        i += 1

    # ── 2. Build players ───────────────────────────────────────────────────────
    print('Building players...')
    players:    list[dict]      = []
    levels:     dict[str, int]  = {}
    city_pids:  list[list[str]] = [[] for _ in CITIES]
    club_pids:  list[list[list[str]]] = [[] for _ in CITIES]
    pid_location: dict[str, tuple[int, int]] = {}

    name_counter: dict[tuple, int] = {}

    for ci, city in enumerate(CITIES):
        country     = city['country']
        firsts      = FIRST_NAMES[country]
        lasts       = LAST_NAMES[country]
        n_players   = counts[ci]
        n_clubs     = max(1, round(n_players / PLAYERS_PER_CLUB))

        # build clubs for this city
        for cli in range(n_clubs):
            club_pids[ci].append([])

        for pi in range(n_players):
            pid   = new_id()
            cli   = pi % n_clubs                          # round-robin into clubs
            cname = club_name(city['name'], cli)

            first = rng.choice(firsts)
            last  = rng.choice(lasts)
            key   = (first, last)
            name_counter[key] = name_counter.get(key, 0) + 1
            disambig = name_counter[key]

            level      = sample_rating(rng)
            email      = fake_email(first, last, rng.choice(EMAIL_DOMAINS), disambig)
            gender     = rng.choices(['male', 'female'], weights=[70, 30])[0]
            hand       = rng.choices(['right', 'left', 'ambi'], weights=[80, 15, 5])[0]
            birth_year = rng.randint(1955, 2008)
            days_ago   = rng.randint(0, TOTAL_DAYS)
            created_at = (END_DATE - timedelta(days=days_ago)).isoformat() + 'T12:00:00.000Z'

            p = {
                'id':            pid,
                'name':          f'{first} {last}',
                'startingLevel': level,
                'email':         email,
                'city':          city['name'],
                'country':       country,
                'club':          cname,
                'gender':        gender,
                'dominantHand':  hand,
                'birthYear':     birth_year,
                'createdAt':     created_at,
            }
            players.append(p)
            levels[pid] = level
            city_pids[ci].append(pid)
            club_pids[ci][cli].append(pid)
            pid_location[pid] = (ci, cli)

    all_pids = [p['id'] for p in players]
    n_clubs_total = sum(len(c) for c in club_pids)
    print(f'  {len(players):,} players |{len(CITIES)} cities |{n_clubs_total} clubs')

    # ── 3. Pre-compute skill-compatible opponent pools ─────────────────────────
    print('Indexing skill-compatible pools...')
    sorted_by_rating = sorted(players, key=lambda p: p['startingLevel'])
    sorted_ratings   = [p['startingLevel'] for p in sorted_by_rating]
    sorted_pids      = [p['id'] for p in sorted_by_rating]

    same_club_pool: dict[str, list[str]] = {}
    same_city_pool: dict[str, list[str]] = {}
    any_pool:       dict[str, list[str]] = {}

    for p in players:
        pid    = p['id']
        rating = p['startingLevel']
        band   = rating_band(rating)
        ci, cli = pid_location[pid]

        same_club_pool[pid] = [
            x for x in club_pids[ci][cli]
            if x != pid and abs(levels[x] - rating) <= band
        ]
        same_city_pool[pid] = [
            x for x in city_pids[ci]
            if x != pid and abs(levels[x] - rating) <= band
        ]
        lo = bisect.bisect_left(sorted_ratings, rating - band)
        hi = bisect.bisect_right(sorted_ratings, rating + band)
        any_pool[pid] = [x for x in sorted_pids[lo:hi] if x != pid]

    # ── 4. Pareto activity weights → sample player A ───────────────────────────
    activity_weights = [rng.paretovariate(ACTIVITY_ALPHA) for _ in players]
    cum_weights      = list(itertools.accumulate(activity_weights))
    total_weight     = cum_weights[-1]

    def sample_player_a() -> str:
        r = rng.random() * total_weight
        return all_pids[bisect.bisect_left(cum_weights, r)]

    # ── 5. Generate matches ────────────────────────────────────────────────────
    print(f'Generating {TOTAL_MATCHES:,} matches...')
    matches: list[dict] = []
    fallback_widen = 0

    for n in range(TOTAL_MATCHES):
        pid_a = sample_player_a()

        r = rng.random()
        if r < SAME_CLUB_PROB:
            pool = same_club_pool[pid_a]
            if not pool:
                pool = same_city_pool[pid_a]
                fallback_widen += 1
        elif r < SAME_CLUB_PROB + SAME_CITY_PROB:
            pool = same_city_pool[pid_a]
        else:
            pool = any_pool[pid_a]

        if not pool:
            pool = any_pool[pid_a]
            fallback_widen += 1
        if not pool:
            # extreme edge — pick anyone other than self (rating outlier)
            pool = [x for x in all_pids if x != pid_a]
            fallback_widen += 1

        pid_b = rng.choice(pool)

        day        = rng.randint(0, TOTAL_DAYS - 1)
        match_date = iso_date(START_DATE + timedelta(days=day))
        level_diff = levels[pid_a] - levels[pid_b]
        games      = random_match_games(rng, level_diff)
        mtype      = rng.choices(MATCH_TYPES, weights=MATCH_WEIGHTS)[0]

        matches.append({
            'id':        new_id(),
            'date':      match_date,
            'playerAId': pid_a,
            'playerBId': pid_b,
            'games':     games,
            'type':      mtype,
            'createdAt': match_date + 'T18:00:00.000Z',
        })

        if (n + 1) % 10_000 == 0:
            print(f'  {n + 1:,} matches built')

    if fallback_widen:
        pct = fallback_widen / TOTAL_MATCHES * 100
        print(f'  (widened pool {fallback_widen:,} times — {pct:.1f}%)')

    # ── 6. Generate groups ─────────────────────────────────────────────────────
    print(f'Generating {TOTAL_GROUPS} groups...')
    groups:        list[dict] = []
    group_members: list[dict] = []
    used_slugs: set[str] = set()

    for gi in range(TOTAL_GROUPS):
        # unique-ish name (retry a few times before suffixing)
        for _ in range(8):
            name = random_group_name(rng)
            slug = slugify(name)
            if slug not in used_slugs:
                break
        else:
            slug = f'{slug}-{gi}'
        used_slugs.add(slug)

        gid     = new_id()
        n_mem   = rng.randint(GROUP_MIN_MEMBERS, GROUP_MAX_MEMBERS)
        members = rng.sample(all_pids, n_mem)
        admin   = rng.choice(members)

        days_ago = rng.randint(0, TOTAL_DAYS)
        gcreated = (END_DATE - timedelta(days=days_ago)).isoformat() + 'T09:00:00.000Z'

        groups.append({
            'id':          gid,
            'name':        name,
            'slug':        slug,
            'isPrivate':   rng.random() < 0.5,
            'createdAt':   gcreated,
        })
        for mpid in members:
            group_members.append({
                'groupId':  gid,
                'playerId': mpid,
                'isAdmin':  mpid == admin,
                'addedAt':  gcreated,
            })

    print(f'  {len(groups)} groups |{len(group_members):,} memberships')

    # ── 7. Write output ────────────────────────────────────────────────────────
    settings = {
        'dampingK':            0.12,
        'pointsWeight':        0.5,
        'pointsExponent':      2,
        'gamesExponent':       5,
        'provisionalThreshold': 5,
        'movingAverageWindow': 4,
    }

    export = {
        'version':      2,
        'exportedAt':   END_DATE.isoformat() + 'T00:00:00.000Z',
        'players':      players,
        'matches':      matches,
        'settings':     settings,
        'groups':       groups,
        'groupMembers': group_members,
    }

    print(f'Writing {OUTPUT} ...')
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(export, f, separators=(',', ':'))

    size_mb = os.path.getsize(OUTPUT) / 1_048_576

    # Stats: rating buckets + match-count quantiles
    buckets = [(1_000, 10_000), (10_000, 25_000), (25_000, 50_000), (50_000, 100_001)]
    bucket_counts = [sum(1 for p in players if lo <= p['startingLevel'] < hi) for lo, hi in buckets]

    matches_per_player: dict[str, int] = {pid: 0 for pid in all_pids}
    for m in matches:
        matches_per_player[m['playerAId']] += 1
        matches_per_player[m['playerBId']] += 1
    sorted_counts = sorted(matches_per_player.values())
    def pct(p): return sorted_counts[int(p * (len(sorted_counts) - 1))]

    print('\nDone.')
    print(f'  File   : {OUTPUT}')
    print(f'  Size   : {size_mb:.1f} MB')
    print(f'  Players: {len(players):,}')
    print(f'  Matches: {len(matches):,}')
    print(f'  Groups : {len(groups)} ({len(group_members):,} memberships)')
    print(f'  Rating distribution:')
    for (lo, hi), n in zip(buckets, bucket_counts):
        bar = '#' * int(n / max(bucket_counts) * 30)
        print(f'    {lo:>6,}-{hi:>6,}: {n:>4} {bar}')
    print(f'  Matches/player: min={sorted_counts[0]} '
          f'p50={pct(0.5)} p90={pct(0.9)} p99={pct(0.99)} max={sorted_counts[-1]}')
    print('\nImport via Settings -> Import JSON in the Boast app.')


if __name__ == '__main__':
    main()
