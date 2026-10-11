"""Fixed DEMO reference data. Boundaries and coordinates are rough synthetic boxes around the pilot areas;
they are NOT official ward maps (C13) and are labelled DEMO everywhere they appear."""
from __future__ import annotations

SOURCE = "DEMO synthetic boundary, not an official ward map"

# key, name_en, name_bn, city_corp, district, (lat, lon), half-size of the square box in metres (None = no polygon)
WARDS = [
    ("bwest", "DEMO · Bashundhara R/A (west)", "ডেমো · বসুন্ধরা আ/এ (পশ্চিম)", "DNCC", "Dhaka", (23.8180, 90.4310), 700),
    ("beast", "DEMO · Bashundhara R/A (east)", "ডেমো · বসুন্ধরা আ/এ (পূর্ব)", "DNCC", "Dhaka", (23.8195, 90.4450), 700),
    ("chashara", "DEMO · Narayanganj Chashara", "ডেমো · নারায়ণগঞ্জ চাষাড়া", "NCC", "Narayanganj", (23.6240, 90.4990), 500),
    ("tanbazar", "DEMO · Narayanganj Tanbazar", "ডেমো · নারায়ণগঞ্জ টানবাজার", "NCC", "Narayanganj", (23.6150, 90.5000), 400),
    ("fatullah", "DEMO · Fatullah (no polygon, 300 m radius)", "ডেমো · ফতুল্লা (সীমানা নেই)", "NCC", "Narayanganj",
     (23.6330, 90.4860), None),
]

# key, name_en, name_bn, ward key, (lat, lon), radius_m, price factor
MARKETS = [
    ("bkb", "DEMO · Bashundhara Kacha Bazar", "ডেমো · বসুন্ধরা কাঁচা বাজার", "bwest", (23.8172, 90.4335), 150, 1.06),
    ("digu", "DEMO · Digu Babu Bazar", "ডেমো · দিগু বাবুর বাজার", "tanbazar", (23.6158, 90.5012), 150, 1.00),
    ("ckb", "DEMO · Chashara Kacha Bazar", "ডেমো · চাষাড়া কাঁচা বাজার", "chashara", (23.6232, 90.4978), 120, 0.98),
]

# name_en, name_bn, variant, unit, base price (BDT), trend key
COMMODITIES = [
    ("Rice", "চাল", "coarse", "kg", 54, None),
    ("Rice", "চাল", "medium", "kg", 64, None),
    ("Rice", "চাল", "fine", "kg", 78, None),
    ("Onion", "পেঁয়াজ", "local", "kg", 90, "onion_rise"),
    ("Onion", "পেঁয়াজ", "imported", "kg", 75, None),
    ("Potato", "আলু", "regular", "kg", 32, None),
    ("Egg", "ডিম", "farm (brown)", "dozen", 145, "egg_drop"),
    ("Soybean oil", "সয়াবিন তেল", "bottled", "litre", 178, None),
    ("Lentil", "মসুর ডাল", "coarse", "kg", 108, None),
]

DEMO_ACCOUNTS = [
    # display name, phone, addresses (kind, ward key), preferred module
    ("Demo Citizen 1", "+8801700000001", [("home", "chashara"), ("work", "bwest")], "green_guard"),
    ("Demo Citizen 2", "+8801700000002", [("home", "tanbazar"), ("other", "chashara")], "price_patrol"),
    ("Demo Citizen 3", "+8801700000003", [("home", "beast"), ("work", "bwest")], "green_guard"),
]

# Seed-only users (no phone, no password: they cannot log in).
SEED_NAMES = ["Rahim", "Karima", "Sabbir", "Nusrat", "Tanvir", "Farzana", "Imran", "Sharmin", "Arif", "Mitu",
              "Jamal", "Ruma", "Hasan", "Laboni", "Rakib"]
# Price volunteers report prices only, like the market teams in the pilot plan (L8). Keeping them apart stops
# their many price results from inflating the reputation of the civic reporters (one shared reputation, Q16).
PRICE_VOLUNTEERS = ["Babul", "Shirin", "Kamal", "Moushumi", "Nayeem", "Popy", "Sohel", "Tania", "Ujjal", "Lima"]
# A brand-new account with no history, used for the low-credibility scenario.
NEWCOMER = "Shimul"

DESCRIPTIONS = {
    "waterlogging": ["Water is standing on the road after the rain, rickshaws cannot pass.",
                     "রাস্তায় হাঁটু পানি জমে আছে, হাঁটা যাচ্ছে না।",
                     "Rastay pani jome ache since morning, school children are wading through it.",
                     "The lane near the mosque is flooded again, about ankle deep."],
    "water_pollution": ["The canal water is black and smells very bad.",
                        "খালের পানি কালো হয়ে গেছে, প্রচণ্ড দুর্গন্ধ।",
                        "Factory water is going straight into the khal, foam on top."],
    "damaged_road": ["Big pothole in the middle of the road, two bikes fell today.",
                     "রাস্তায় বড় গর্ত, গাড়ি চলতে কষ্ট হচ্ছে।",
                     "Road broken near the bus stand, rastay boro gorto."],
    "deforestation": ["Several old trees were cut beside the road last night.",
                      "রাস্তার পাশে অনেক গাছ কেটে ফেলা হয়েছে।",
                      "Onek gach kete feleche near the field."],
    "drainage": ["The drain is blocked and dirty water is overflowing onto the footpath.",
                 "ড্রেন বন্ধ হয়ে ময়লা পানি উপচে পড়ছে।",
                 "Drain bondho, nongra pani uthe ashche."],
    "garbage": ["Garbage has not been collected for days, it is piling up on the corner.",
                "কয়েকদিন ধরে ময়লা পরিষ্কার হয়নি, রাস্তার মোড়ে স্তূপ।",
                "Moyla porishkar hoyni, crows and dogs everywhere."],
    "streetlight": ["The street light is broken and the road is completely dark at night.",
                    "রাস্তার বাতি নষ্ট, রাতে অন্ধকার।",
                    "Street light noshto for a week, not safe at night."],
}

# Descriptions that do not fit the chosen category (used for the low-credibility scenario).
OFF_TOPIC = ["Nice weather today.", "Testing the app, hello.", "Selling a used bicycle, call me."]
