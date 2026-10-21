#!/usr/bin/env python3
"""
Build Routed's market universe and road-distance matrix from free, open sources. Run once, offline, and commit
the outputs (src/lib/data/markets.json, src/lib/data/road-matrix.json). The app never calls these services at
runtime.

Sources (see docs/SOURCES.md for the full list, with licenses):
  1. U.S. Census Bureau / OMB: principal cities of Metropolitan Statistical Areas (July 2023 delineation, list 2).
  2. U.S. Census Bureau: Vintage 2025 metro (CBSA) population estimates.
  3. U.S. Census Bureau: Vintage 2025 city and town (incorporated place) population estimates.
  4. U.S. Census Bureau: 2025 Gazetteer place file (an internal point, lat/lon, for each place).
  5. OpenStreetMap via the Overpass API (one bulk request): features tagged amenity=music_venue|nightclub|theatre or
     live_music=yes in the US, counted locally within VENUE_RADIUS_M of each city. ODbL 1.0.
  6. OpenStreetMap via Overpass (one bulk request, CSV): place=city/town nodes, used as each city's centre point
     when one of the same name lies within 80 km of the Census internal point.
  7. OSRM (car profile) on the FOSSGIS demo server (OpenStreetMap data): city-to-city road distance and duration.
     Usage policy: at most 1 request per second, no heavy use, a valid User-Agent, and attribution. This script
     sends about 16 table requests in total, at least 1.5 s apart.

Selection rule (deterministic, from official definitions):
  every city named in the title of a Metropolitan Statistical Area in the lower 48 states + DC whose 2025
  population estimate is >= MIN_METRO_POP, if it is an incorporated place with a Vintage 2025 estimate.

Usage:  python3 scripts/data/build_markets.py [--cache DIR] [--skip-venues] [--skip-roads]
Needs Python 3.10+ and openpyxl (only to read the OMB .xlsx).
"""
import argparse
import re
import hashlib, base64, csv, datetime as dt, io, json, os, struct, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

MIN_METRO_POP = 200_000
VENUE_RADIUS_M = 16_093  # 10 miles
EXCLUDED_STATES = {"02", "15", "72"}  # Alaska, Hawaii, Puerto Rico: not reachable by road from the lower 48
UA = "Routed/0.1 (hackathon prototype; one-off offline data build; https://github.com/)"
URLS = {
    "principal_cities": "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list2_2023.xlsx",
    "cbsa_pop": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/cbsa-est2025-alldata.csv",
    "place_pop": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv",
    "gazetteer": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip",
}
OVERPASS = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
# Self-hosted OSRM for refreshes at scale: OSRM_URL=http://localhost:5000/table/v1/driving/ (see docs/SOURCES.md).
OSRM = os.environ.get("OSRM_URL", "https://router.project-osrm.org/table/v1/driving/")
OSRM_BLOCK = 100
NO_ROUTE = 65535
ST_ABBR = {"01":"AL","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"}


def fetch(url, cache, name=None, data=None):
    path = os.path.join(cache, name or os.path.basename(urllib.parse.urlparse(url).path))
    if data is None and os.path.exists(path):
        return open(path, "rb").read()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=900) as r:
        body = r.read()
    if data is None:
        open(path, "wb").write(body)
    return body


# Census names for consolidated city-county governments -> the name people use. Presentation only; the GEOID and
# every number still come from the Census row.
SUFFIXES = (" city (balance)", " metropolitan government (balance)", " unified government (balance)",
            " consolidated government (balance)", " metro government (balance)")
DISPLAY = {"Nashville-Davidson": "Nashville", "Athens-Clarke County": "Athens", "Augusta-Richmond County": "Augusta",
           "Louisville/Jefferson County": "Louisville", "Lexington-Fayette": "Lexington", "Boise City": "Boise",
           "Macon-Bibb County": "Macon", "Barnstable Town": "Barnstable"}


def clean(name):
    for s in SUFFIXES:
        if name.endswith(s):
            return name[: -len(s)]
    return name


def named_in_title(name, title):
    head = title.split(",")[0]
    return head == name or head.startswith(name + "-") or head.endswith("-" + name) or ("-" + name + "-") in head


def post_with_retry(url, cache, data, tries=5):
    """Polite retries for the shared public Overpass server (502/504/429 mean it is busy): 30 s, 60 s, 90 s..."""
    for k in range(tries):
        try:
            return fetch(url, cache, data=data)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or k == tries - 1:
                raise
            print(f"  overpass busy ({e.code}); waiting {30 * (k + 1)} s", file=sys.stderr)
            time.sleep(30 * (k + 1))
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:  # dropped connection: same polite back-off
            if k == tries - 1:
                raise
            print(f"  overpass connection dropped ({e}); waiting {30 * (k + 1)} s", file=sys.stderr)
            time.sleep(30 * (k + 1))


def slug(name, st):
    return f"{name.lower().replace('.', '').replace(' ', '-')}-{st.lower()}"


def build_universe(cache):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(fetch(URLS["principal_cities"], cache)), read_only=True)
    rows = [r for r in wb.active.iter_rows(values_only=True)][3:]
    metro_pop = {}
    for r in csv.DictReader(io.StringIO(fetch(URLS["cbsa_pop"], cache).decode("latin-1"))):
        if r["LSAD"] == "Metropolitan Statistical Area":
            metro_pop[r["CBSA"]] = int(r["POPESTIMATE2025"])
    place_pop = {}
    for r in csv.DictReader(io.StringIO(fetch(URLS["place_pop"], cache).decode("latin-1"))):
        if r["SUMLEV"] == "162":
            place_pop[r["STATE"] + r["PLACE"]] = int(r["POPESTIMATE2025"])
    z = zipfile.ZipFile(io.BytesIO(fetch(URLS["gazetteer"], cache)))
    gaz = {}
    for r in csv.DictReader(io.StringIO(z.read(z.namelist()[0]).decode("utf-8")), delimiter="|"):
        r = {k.strip(): v.strip() for k, v in r.items()}
        gaz[r["GEOID"]] = (float(r["INTPTLAT"]), float(r["INTPTLONG"]))
    cities, seen = [], set()
    for r in rows:
        if not r or not r[0] or not r[2]:
            continue
        cbsa, title, kind, name, st, pl = (str(x) if x is not None else "" for x in r)
        if kind != "Metropolitan Statistical Area" or st in EXCLUDED_STATES or metro_pop.get(cbsa, 0) < MIN_METRO_POP:
            continue
        name = clean(name)
        if not named_in_title(name, title):
            continue  # not named in the metro's title
        geoid = st + pl
        if geoid not in place_pop or geoid not in gaz or geoid in seen:
            continue
        seen.add(geoid)
        lat, lon = gaz[geoid]
        abbr = ST_ABBR[st]
        display = DISPLAY.get(name, name)
        cities.append({
            "id": slug(display, abbr), "name": display, "censusName": name, "state": abbr, "lat": round(lat, 5), "lon": round(lon, 5),
            "population": place_pop[geoid], "geoid": geoid,
            "metro": {"cbsa": cbsa, "title": title, "population": metro_pop[cbsa]},
        })
    cities.sort(key=lambda c: (-c["metro"]["population"], -c["population"]))
    ids = [c["id"] for c in cities]
    assert len(ids) == len(set(ids)), "duplicate city ids"
    return cities


VENUE_QUERY = """[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  nwr["amenity"~"^(music_venue|nightclub|theatre)$"](area.us);
  nwr["live_music"="yes"](area.us);
);
out tags center;"""


def haversine_m(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


# CSV output (id, lat, lon, name) keeps the response small: no other tags are needed.
# A lower-48 bounding box is cheaper for the server than an area filter; stray Canadian/Mexican towns never match
# (same name AND within 80 km of a US Census point).
# Exact tag values (indexed) are much cheaper for the server than a regex.
PLACE_QUERY = """[out:csv(::id,::lat,::lon,name;false)][timeout:600];
(node[place=city][name](24.3,-125.0,49.5,-66.8);node[place=town][name](24.3,-125.0,49.5,-66.8););
out;"""
PLACE_MATCH_M = 80_000


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("saint ", "st ").replace("st. ", "st "))


def place_centres(cities, cache):
    """Move each city's point from the Census internal point (a geometric point inside the boundary, which can sit far
    from downtown: San Francisco's is in the Pacific because the city includes the Farallon Islands) to the
    OpenStreetMap place=city/town node of the same name: the mapped city centre. One bulk Overpass request, cached.
    Cities with no same-name node within 80 km keep the Census point. Returns (moved, kept) counts."""
    path = os.path.join(cache, "overpass-us-places.tsv")
    if not os.path.exists(path):
        body = post_with_retry(OVERPASS, cache, urllib.parse.urlencode({"data": PLACE_QUERY}).encode())
        if body.lstrip().startswith(b"#") or b"<html" in body[:200]:  # Overpass reports errors in the body with HTTP 200
            raise RuntimeError("Overpass returned an error page instead of CSV: " + body[:200].decode(errors="replace"))
        open(path, "wb").write(body)
    by_name = {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 4 or not parts[3]:
            continue
        e = {"id": parts[0], "lat": float(parts[1]), "lon": float(parts[2])}
        by_name.setdefault(norm(parts[3]), []).append(e)
    moved = kept = 0
    for c in cities:
        best = None
        for nm in {norm(c["name"]), norm(c["censusName"])}:
            for e in by_name.get(nm, []):
                d = haversine_m(c["lat"], c["lon"], e["lat"], e["lon"])
                if d <= PLACE_MATCH_M and (best is None or d < best[0]):
                    best = (d, e)
        c["census_point"] = [c["lat"], c["lon"]]
        if best:
            c["lat"], c["lon"], c["point"] = round(best[1]["lat"], 5), round(best[1]["lon"], 5), f"osm:node/{best[1]['id']}"
            moved += 1
        else:
            c["point"] = "census:internal-point"
            kept += 1
        del c["census_point"]
    return moved, kept


def add_venues(cities, cache):
    """One Overpass request for every live-performance venue mapped in the US (cached), then local counting.
    A single bulk request is far lighter on the shared server than hundreds of per-city queries."""
    path = os.path.join(cache, "overpass-us-venues.json")
    if not os.path.exists(path):
        body = post_with_retry(OVERPASS, cache, urllib.parse.urlencode({"data": VENUE_QUERY}).encode())
        open(path, "wb").write(body)
    els = json.load(open(path))["elements"]
    pts = []
    for e in els:
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None or lon is None:
            continue
        t = e.get("tags", {})
        kind = t.get("amenity") if t.get("amenity") in ("music_venue", "nightclub", "theatre") else "live_music"
        pts.append((lat, lon, kind))
    dlat = VENUE_RADIUS_M / 111_000 + 0.01
    for c in cities:
        counts = {"music_venue": 0, "nightclub": 0, "theatre": 0, "live_music": 0}
        for lat, lon, kind in pts:
            if abs(lat - c["lat"]) > dlat or abs(lon - c["lon"]) > dlat * 1.6:
                continue
            if haversine_m(c["lat"], c["lon"], lat, lon) <= VENUE_RADIUS_M:
                counts[kind] += 1
        c["venues"] = {"total": sum(counts.values()), **counts}
    return len(pts)


def road_matrix(cities, cache):
    path = os.path.join(cache, "osrm-blocks.json")
    blocks = json.load(open(path)) if os.path.exists(path) else {}
    n = len(cities)
    coords = [f'{c["lon"]},{c["lat"]}' for c in cities]
    miles = [[NO_ROUTE] * n for _ in range(n)]
    minutes = [[NO_ROUTE] * n for _ in range(n)]
    starts = list(range(0, n, OSRM_BLOCK))
    for si in starts:
        for di in starts:
            src = list(range(si, min(n, si + OSRM_BLOCK)))
            dst = list(range(di, min(n, di + OSRM_BLOCK)))
            # Key includes the coordinates, so moving a city re-requests only the blocks it is in.
            key = f"{si}:{di}:" + hashlib.sha1("|".join(coords[g] for g in src + dst).encode()).hexdigest()[:12]
            if key not in blocks:
                idx = sorted(set(src) | set(dst))
                pos = {g: k for k, g in enumerate(idx)}
                url = OSRM + ";".join(coords[g] for g in idx) + "?annotations=distance,duration&sources=" + \
                    ";".join(str(pos[g]) for g in src) + "&destinations=" + ";".join(str(pos[g]) for g in dst)
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=300) as r:
                    body = json.loads(r.read())
                assert body["code"] == "Ok", body.get("message")
                blocks[key] = {"distances": body["distances"], "durations": body["durations"]}
                json.dump(blocks, open(path, "w"))
                print(f"  osrm block {key}", file=sys.stderr)
                time.sleep(1.5)  # policy: max 1 request/second
            b = blocks[key]
            for a, gi in enumerate(src):
                for d, gj in enumerate(dst):
                    m, s = b["distances"][a][d], b["durations"][a][d]
                    if m is not None and s is not None:
                        miles[gi][gj] = min(NO_ROUTE - 1, round(m / 1609.344))
                        minutes[gi][gj] = min(NO_ROUTE - 1, round(s / 60))
    pack = lambda mat: base64.b64encode(b"".join(struct.pack("<H", v) for row in mat for v in row)).decode()
    return {"miles": pack(miles), "minutes": pack(minutes)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(__file__), ".cache"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "data"))
    ap.add_argument("--skip-venues", action="store_true")
    ap.add_argument("--skip-roads", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    today = dt.date.today().isoformat()
    cities = build_universe(a.cache)
    print(f"{len(cities)} cities", file=sys.stderr)
    moved, kept = place_centres(cities, a.cache)
    print(f"  city points: {moved} from OSM place nodes, {kept} Census internal points", file=sys.stderr)
    venue_points = add_venues(cities, a.cache) if not a.skip_venues else 0
    meta = {
        "built": today,
        "rule": f"Cities named in the title of a Metropolitan Statistical Area (OMB, July 2023) in the lower 48 + DC with a 2025 metro population estimate >= {MIN_METRO_POP:,}; incorporated places with a Vintage 2025 estimate only.",
        "sources": {
            "principalCities": URLS["principal_cities"], "metroPopulation": URLS["cbsa_pop"],
            "placePopulation": URLS["place_pop"],
            "coordinates": f"OpenStreetMap place=city/town node of the same name within 80 km of the Census Gazetteer internal point ({moved} cities); otherwise the Gazetteer internal point ({kept}). Gazetteer: " + URLS["gazetteer"],
            "venues": f"OpenStreetMap contributors via the Overpass API (downloaded {today}; ODbL 1.0): features tagged amenity=music_venue, amenity=nightclub, amenity=theatre or live_music=yes, counted within 10 mi of each city's point.",
        },
        "venuePointsUS": venue_points,
        "venueRadiusMi": 10,
    }
    json.dump({"meta": meta, "cities": cities}, open(os.path.join(a.out, "markets.json"), "w"), indent=0, separators=(",", ":"))
    if not a.skip_roads:
        m = road_matrix(cities, a.cache)
        out = {"meta": {"built": today, "engine": "OSRM 5.x, car profile, FOSSGIS demo server (router.project-osrm.org)",
                        "data": "OpenStreetMap contributors, ODbL 1.0", "units": "miles (rounded), minutes (rounded); 65535 = no route",
                        "order": "row = origin, column = destination, same order as ids"},
               "ids": [c["id"] for c in cities], **m}
        json.dump(out, open(os.path.join(a.out, "road-matrix.json"), "w"), separators=(",", ":"))
    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()
