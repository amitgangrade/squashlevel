#!/usr/bin/env python3
"""
Scale-test data generator for Boast (SquashLevel).

Generates:
  - 10,000 players across 10 global cities (20 clubs × 50 players each)
  - ~300,000 matches over 5 years (avg 1 match/player/month)

Output: fixtures/scale-test-10k.json  (~60-80 MB compact JSON)

Usage:
    python fixtures/generate_scale_data.py

No external dependencies — uses only the Python standard library.
"""

import json
import os
import random
import uuid
from datetime import date, timedelta

# ── Configuration ──────────────────────────────────────────────────────────────
CLUBS_PER_CITY   = 20
PLAYERS_PER_CLUB = 50       # 10 cities × 20 clubs × 50 = 10,000 players
MONTHS           = 60       # 5 years
SAME_CLUB_PROB   = 0.70
SAME_CITY_PROB   = 0.20
# remaining 0.10 → any city

START_DATE  = date(2021, 5, 9)
END_DATE    = date(2026, 5, 9)
TOTAL_DAYS  = (END_DATE - START_DATE).days

MATCH_TYPES   = ['friendly', 'box', 'league', 'tournament']
MATCH_WEIGHTS = [0.50,       0.30,  0.15,     0.05]

OUTPUT = os.path.join(os.path.dirname(__file__), 'scale-test-10k.json')
SEED   = 42  # fixed seed → reproducible dataset

# ── City definitions ───────────────────────────────────────────────────────────
CITIES = [
    {'name': 'London',        'country': 'GB'},
    {'name': 'New York',      'country': 'US'},
    {'name': 'Dubai',         'country': 'AE'},
    {'name': 'Mumbai',        'country': 'IN'},
    {'name': 'Cairo',         'country': 'EG'},
    {'name': 'Hong Kong',     'country': 'HK'},
    {'name': 'Sydney',        'country': 'AU'},
    {'name': 'Toronto',       'country': 'CA'},
    {'name': 'Singapore',     'country': 'SG'},
    {'name': 'Johannesburg',  'country': 'ZA'},
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
    'AU': ['Jack', 'Oliver', 'Noah', 'William', 'Ethan', 'Olivia', 'Charlotte', 'Amelia',
           'Isla', 'Mia', 'Lucas', 'Liam', 'Ava', 'Grace', 'Henry', 'Thomas'],
    'CA': ['Liam', 'Noah', 'Oliver', 'Ethan', 'Lucas', 'Emma', 'Olivia', 'Charlotte',
           'Ava', 'Sofia', 'Aiden', 'Mason', 'Sophia', 'Mia', 'Arjun', 'Mei'],
    'SG': ['Wei', 'Jing', 'Hui', 'Mei', 'Rajan', 'Priya', 'Arjun', 'Farah',
           'Ahmad', 'Siti', 'Kai', 'Min', 'Ling', 'Raj', 'Zhen', 'Nurul'],
    'ZA': ['Thabo', 'Sipho', 'Lebo', 'Nkosi', 'Bongani', 'Nandi', 'Zanele', 'Ayanda',
           'Thembi', 'Nomsa', 'Khaya', 'Siyanda', 'Lindiwe', 'Mpho', 'Lerato', 'Kabelo'],
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
    'AU': ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White',
           'Martin', 'Anderson', 'Thompson', 'Lee', 'Harris', 'Scott', 'Young'],
    'CA': ['Smith', 'Brown', 'Tremblay', 'Martin', 'Roy', 'Wilson', 'MacDonald', 'Taylor',
           'Johnson', 'Lee', 'Nguyen', 'Singh', 'Patel', 'Kim', 'Chen'],
    'SG': ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chan', 'Goh', 'Ong',
           'Kumar', 'Singh', 'Rahman', 'Abdullah', 'Yeo', 'Chua', 'Koh'],
    'ZA': ['Dlamini', 'Nkosi', 'Ndlovu', 'Zulu', 'Mthembu', 'Khumalo', 'Sithole', 'Mkhize',
           'Cele', 'Buthelezi', 'Molefe', 'Smith', 'Botha', 'Van der Merwe', 'Mokoena'],
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

# ── Helpers ────────────────────────────────────────────────────────────────────

def new_id() -> str:
    return str(uuid.uuid4())


def random_game(rng: random.Random, a_win_prob: float) -> dict:
    """One squash game score; winner gets 11 (or more on deuce)."""
    a_wins = rng.random() < a_win_prob
    loser  = rng.randint(0, 9)
    if loser == 9 and rng.random() < 0.3:   # deuce ~30% of 9-all games
        extra = rng.randint(1, 3) * 2        # 2, 4, or 6 extra points
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
    f = first.lower().replace(' ', '').replace('-', '')
    l = last.lower().replace(' ', '').replace('-', '')
    return f'{f}.{l}{disambig}@{domain}'


# ── Main generation ────────────────────────────────────────────────────────────

def main() -> None:
    rng = random.Random(SEED)

    # ── 1. Players ─────────────────────────────────────────────────────────────
    print('Building players...')
    players:     list[dict]  = []
    levels:      dict[str, int] = {}     # pid → startingLevel
    city_pids:   list[list[str]] = [[] for _ in CITIES]
    club_pids:   list[list[list[str]]] = [[[] for _ in range(CLUBS_PER_CITY)] for _ in CITIES]

    name_counter: dict[tuple, int] = {}

    for ci, city in enumerate(CITIES):
        country    = city['country']
        firsts     = FIRST_NAMES[country]
        lasts      = LAST_NAMES[country]
        domains    = EMAIL_DOMAINS

        for cli in range(CLUBS_PER_CITY):
            cname = club_name(city['name'], cli)

            for pi in range(PLAYERS_PER_CLUB):
                pid   = new_id()
                first = rng.choice(firsts)
                last  = rng.choice(lasts)

                # Disambiguate duplicate name combos
                key = (first, last)
                name_counter[key] = name_counter.get(key, 0) + 1
                disambig = name_counter[key]

                level      = rng.randint(1_000, 100_000)
                email      = fake_email(first, last, rng.choice(domains), disambig)
                gender     = rng.choices(['male', 'female'], weights=[70, 30])[0]
                hand       = rng.choices(['right', 'left', 'ambi'], weights=[80, 15, 5])[0]
                birth_year = rng.randint(1960, 2005)
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
                levels[pid]           = level
                city_pids[ci].append(pid)
                club_pids[ci][cli].append(pid)

    # Flat list for random cross-city matches
    all_pids = [p['id'] for p in players]

    # pid → (city_idx, club_idx) for quick lookup
    pid_location: dict[str, tuple[int, int]] = {}
    for ci in range(len(CITIES)):
        for cli in range(CLUBS_PER_CITY):
            for pid in club_pids[ci][cli]:
                pid_location[pid] = (ci, cli)

    print(f'  {len(players):,} players across {len(CITIES)} cities, {len(CITIES)*CLUBS_PER_CITY} clubs')

    # ── 2. Matches — streamed directly to file ─────────────────────────────────
    # Each player generates 30 matches as playerA → 300K total.
    # They'll appear as playerB ~30 more times (from others), giving ~60 total each.
    MATCHES_AS_A = MONTHS // 2   # 30

    print(f'Streaming {len(players) * MATCHES_AS_A:,} matches to {OUTPUT} ...')

    settings = {
        'dampingK':            0.12,
        'pointsWeight':        0.5,
        'pointsExponent':      2,
        'gamesExponent':       5,
        'provisionalThreshold': 5,
        'movingAverageWindow': 4,
    }

    match_count = 0
    report_every = 50_000

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        # Header + players array (small, ~5 MB)
        f.write('{"version":1,"exportedAt":"2026-05-09T00:00:00.000Z","players":')
        json.dump(players, f, separators=(',', ':'))
        f.write(',"matches":[')

        first_match = True

        for player in players:
            pid       = player['id']
            ci, cli   = pid_location[pid]
            my_club   = club_pids[ci][cli]
            my_city   = city_pids[ci]

            for _ in range(MATCHES_AS_A):
                # Choose opponent pool
                r = rng.random()
                if r < SAME_CLUB_PROB:
                    pool = my_club
                elif r < SAME_CLUB_PROB + SAME_CITY_PROB:
                    pool = my_city
                else:
                    pool = all_pids

                # Rejection-sample a different player (collision rate < 0.1%)
                opp = pid
                while opp == pid:
                    opp = rng.choice(pool)

                # Random date uniformly in [START_DATE, END_DATE)
                day        = rng.randint(0, TOTAL_DAYS - 1)
                match_date = iso_date(START_DATE + timedelta(days=day))

                level_diff = levels[pid] - levels[opp]
                games      = random_match_games(rng, level_diff)
                mtype      = rng.choices(MATCH_TYPES, weights=MATCH_WEIGHTS)[0]

                m = {
                    'id':        new_id(),
                    'date':      match_date,
                    'playerAId': pid,
                    'playerBId': opp,
                    'games':     games,
                    'type':      mtype,
                    'createdAt': match_date + 'T18:00:00.000Z',
                }

                if not first_match:
                    f.write(',')
                json.dump(m, f, separators=(',', ':'))
                first_match  = False
                match_count += 1

                if match_count % report_every == 0:
                    print(f'  {match_count:,} matches written...')

        # Close matches array + settings + root object
        f.write('],"settings":')
        json.dump(settings, f, separators=(',', ':'))
        f.write('}')

    size_mb = os.path.getsize(OUTPUT) / 1_048_576
    print(f'\nDone.')
    print(f'  File  : {OUTPUT}')
    print(f'  Size  : {size_mb:.1f} MB')
    print(f'  Players: {len(players):,}')
    print(f'  Matches: {match_count:,}')
    print('\nImport via Settings -> Import JSON in the Boast app.')
    print(f'NOTE: the cloud import batches inserts automatically (500 rows/batch).')


if __name__ == '__main__':
    main()
