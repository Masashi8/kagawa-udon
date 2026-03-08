import os
import json
import uuid
import psycopg2
import psycopg2.extras
import requests as http_requests
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, send_file

app = Flask(__name__, static_folder='public', static_url_path='')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Config from environment variables ───────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')
STORAGE_BUCKET = 'udon-images'

ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# ─── Database ────────────────────────────────────────────
def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS shops (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            area TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            shop_id INTEGER NOT NULL REFERENCES shops(id),
            username TEXT NOT NULL,
            noodle_score INTEGER NOT NULL CHECK(noodle_score BETWEEN 1 AND 5),
            broth_score INTEGER NOT NULL CHECK(broth_score BETWEEN 1 AND 5),
            topping_score INTEGER NOT NULL CHECK(topping_score BETWEEN 1 AND 5),
            value_score INTEGER NOT NULL CHECK(value_score BETWEEN 1 AND 5),
            atmosphere_score INTEGER NOT NULL CHECK(atmosphere_score BETWEEN 1 AND 5),
            udon_type TEXT NOT NULL DEFAULT '',
            comment TEXT DEFAULT '',
            image_urls TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.commit()
    cur.close()
    conn.close()

init_db()

def row_to_dict(cur):
    """Fetch one row as dict"""
    row = cur.fetchone()
    if not row:
        return None
    cols = [desc[0] for desc in cur.description]
    d = dict(zip(cols, row))
    # Convert datetime to string
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.strftime('%Y-%m-%d %H:%M:%S')
    return d

def rows_to_list(cur):
    """Fetch all rows as list of dicts"""
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    result = []
    for row in rows:
        d = dict(zip(cols, row))
        for k, v in d.items():
            if isinstance(v, datetime):
                d[k] = v.strftime('%Y-%m-%d %H:%M:%S')
        result.append(d)
    return result

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXT

def parse_image_urls(row_dict):
    try:
        row_dict['image_urls'] = json.loads(row_dict.get('image_urls', '[]'))
    except:
        row_dict['image_urls'] = []
    return row_dict

# ─── Supabase Storage ────────────────────────────────────
def upload_to_supabase(file_obj):
    """Upload a file to Supabase Storage, return public URL"""
    if not file_obj or not file_obj.filename or not allowed_file(file_obj.filename):
        return None
    ext = file_obj.filename.rsplit('.', 1)[1].lower()
    unique_name = f"{int(datetime.now().timestamp()*1000)}-{uuid.uuid4().hex[:8]}.{ext}"
    file_path = f"{unique_name}"

    mime_types = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'
    }
    content_type = mime_types.get(ext, 'application/octet-stream')

    file_data = file_obj.read()

    resp = http_requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{file_path}",
        headers={
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': content_type,
            'x-upsert': 'true'
        },
        data=file_data
    )

    if resp.status_code in (200, 201):
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{file_path}"
        return public_url
    else:
        print(f"Storage upload error: {resp.status_code} {resp.text}")
        return None

def delete_from_supabase(url):
    """Delete a file from Supabase Storage by its public URL"""
    if not url or STORAGE_BUCKET not in url:
        return
    # Extract path from URL
    prefix = f"/storage/v1/object/public/{STORAGE_BUCKET}/"
    idx = url.find(prefix)
    if idx == -1:
        return
    file_path = url[idx + len(prefix):]

    http_requests.delete(
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}",
        headers={
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json'
        },
        json={'prefixes': [file_path]}
    )

def save_uploaded_images(files):
    urls = []
    for f in files:
        url = upload_to_supabase(f)
        if url:
            urls.append(url)
    return urls

# ─── API: Shops ──────────────────────────────────────────
@app.route('/api/shops', methods=['GET'])
def get_shops():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT s.*,
            COUNT(r.id) as review_count,
            ROUND(AVG(r.noodle_score)::numeric, 1) as avg_noodle,
            ROUND(AVG(r.broth_score)::numeric, 1) as avg_broth,
            ROUND(AVG(r.topping_score)::numeric, 1) as avg_topping,
            ROUND(AVG(r.value_score)::numeric, 1) as avg_value,
            ROUND(AVG(r.atmosphere_score)::numeric, 1) as avg_atmosphere,
            ROUND((COALESCE(AVG(r.noodle_score),0) + COALESCE(AVG(r.broth_score),0) + COALESCE(AVG(r.topping_score),0) + COALESCE(AVG(r.value_score),0) + COALESCE(AVG(r.atmosphere_score),0))::numeric / 5.0, 2) as avg_total
        FROM shops s
        LEFT JOIN reviews r ON s.id = r.shop_id
        GROUP BY s.id
        ORDER BY avg_total DESC, s.name ASC
    """)
    result = rows_to_list(cur)
    cur.close()
    conn.close()
    for s in result:
        if s['review_count'] == 0:
            for k in ['avg_total','avg_noodle','avg_broth','avg_topping','avg_value','avg_atmosphere']:
                s[k] = None
        else:
            for k in ['avg_total','avg_noodle','avg_broth','avg_topping','avg_value','avg_atmosphere']:
                if s[k] is not None:
                    s[k] = float(s[k])
    return jsonify(result)

@app.route('/api/shops', methods=['POST'])
def add_shop():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    area = (data.get('area') or '').strip()
    if not name:
        return jsonify({'error': '\u5e97\u540d\u306f\u5fc5\u9808\u3067\u3059'}), 400
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO shops (name, area) VALUES (%s, %s) RETURNING id', (name, area))
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.execute('SELECT * FROM shops WHERE id = %s', (new_id,))
        shop = row_to_dict(cur)
        cur.close()
        conn.close()
        return jsonify(shop)
    except psycopg2.IntegrityError:
        conn.rollback()
        cur.close()
        conn.close()
        return jsonify({'error': '\u3053\u306e\u5e97\u540d\u306f\u65e2\u306b\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u3059'}), 409

@app.route('/api/shops/<int:shop_id>', methods=['GET'])
def get_shop_detail(shop_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM shops WHERE id = %s', (shop_id,))
    shop = row_to_dict(cur)
    if not shop:
        cur.close()
        conn.close()
        return jsonify({'error': '\u5e97\u8217\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093'}), 404

    cur.execute("""
        SELECT
            COUNT(*) as review_count,
            ROUND(AVG(noodle_score)::numeric, 1) as avg_noodle,
            ROUND(AVG(broth_score)::numeric, 1) as avg_broth,
            ROUND(AVG(topping_score)::numeric, 1) as avg_topping,
            ROUND(AVG(value_score)::numeric, 1) as avg_value,
            ROUND(AVG(atmosphere_score)::numeric, 1) as avg_atmosphere,
            ROUND((COALESCE(AVG(noodle_score),0) + COALESCE(AVG(broth_score),0) + COALESCE(AVG(topping_score),0) + COALESCE(AVG(value_score),0) + COALESCE(AVG(atmosphere_score),0))::numeric / 5.0, 2) as avg_total
        FROM reviews WHERE shop_id = %s
    """, (shop_id,))
    stats = row_to_dict(cur)
    if stats['review_count'] == 0:
        for k in ['avg_total','avg_noodle','avg_broth','avg_topping','avg_value','avg_atmosphere']:
            stats[k] = None
    else:
        for k in ['avg_total','avg_noodle','avg_broth','avg_topping','avg_value','avg_atmosphere']:
            if stats[k] is not None:
                stats[k] = float(stats[k])

    cur.execute('SELECT * FROM reviews WHERE shop_id = %s ORDER BY created_at DESC', (shop_id,))
    reviews = rows_to_list(cur)
    for r in reviews:
        parse_image_urls(r)

    cur.execute("""
        SELECT udon_type, COUNT(*) as count
        FROM reviews WHERE shop_id = %s AND udon_type != ''
        GROUP BY udon_type ORDER BY count DESC
    """, (shop_id,))
    udon_types = rows_to_list(cur)

    cur.close()
    conn.close()
    return jsonify({'shop': shop, 'stats': stats, 'reviews': reviews, 'udonTypes': udon_types})

# ─── API: Reviews ────────────────────────────────────────
@app.route('/api/reviews', methods=['GET'])
def get_reviews():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT r.*, s.name as shop_name, s.area as shop_area
        FROM reviews r JOIN shops s ON r.shop_id = s.id
        ORDER BY r.created_at DESC LIMIT 100
    """)
    reviews = rows_to_list(cur)
    cur.close()
    conn.close()
    for r in reviews:
        parse_image_urls(r)
    return jsonify(reviews)

@app.route('/api/reviews', methods=['POST'])
def add_review():
    shop_id = request.form.get('shop_id')
    username = (request.form.get('username') or '').strip()

    if not shop_id or not username:
        return jsonify({'error': '\u5e97\u8217\u3068\u30e6\u30fc\u30b6\u30fc\u540d\u306f\u5fc5\u9808\u3067\u3059'}), 400

    images = request.files.getlist('images')[:3]
    image_urls = save_uploaded_images(images)

    try:
        noodle = int(request.form.get('noodle_score', 3))
        broth = int(request.form.get('broth_score', 3))
        topping = int(request.form.get('topping_score', 3))
        value = int(request.form.get('value_score', 3))
        atmosphere = int(request.form.get('atmosphere_score', 3))
    except ValueError:
        noodle = broth = topping = value = atmosphere = 3

    udon_type = (request.form.get('udon_type') or '').strip()
    comment = (request.form.get('comment') or '').strip()

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO reviews (shop_id, username, noodle_score, broth_score, topping_score, value_score, atmosphere_score, udon_type, comment, image_urls)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (int(shop_id), username, noodle, broth, topping, value, atmosphere, udon_type, comment, json.dumps(image_urls)))
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.execute('SELECT * FROM reviews WHERE id = %s', (new_id,))
        review = row_to_dict(cur)
        cur.close()
        conn.close()
        parse_image_urls(review)
        return jsonify(review)
    except Exception as e:
        conn.rollback()
        cur.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/reviews/<int:review_id>', methods=['DELETE'])
def delete_review(review_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM reviews WHERE id = %s', (review_id,))
    review = row_to_dict(cur)
    if not review:
        cur.close()
        conn.close()
        return jsonify({'error': '\u30ec\u30d3\u30e5\u30fc\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093'}), 404

    try:
        image_urls = json.loads(review.get('image_urls', '[]'))
        for url in image_urls:
            delete_from_supabase(url)
    except:
        pass

    cur.execute('DELETE FROM reviews WHERE id = %s', (review_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── API: Stats ──────────────────────────────────────────
@app.route('/api/stats/overview', methods=['GET'])
def get_overview():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT
            (SELECT COUNT(*) FROM shops) as total_shops,
            (SELECT COUNT(*) FROM reviews) as total_reviews,
            (SELECT COUNT(DISTINCT username) FROM reviews) as total_users
    """)
    totals = row_to_dict(cur)

    cur.execute("""
        SELECT s.id, s.name, s.area,
            COUNT(r.id) as review_count,
            ROUND((AVG(r.noodle_score) + AVG(r.broth_score) + AVG(r.topping_score) + AVG(r.value_score) + AVG(r.atmosphere_score))::numeric / 5.0, 2) as avg_total
        FROM shops s JOIN reviews r ON s.id = r.shop_id
        GROUP BY s.id HAVING COUNT(r.id) >= 1
        ORDER BY avg_total DESC LIMIT 5
    """)
    top_shops = rows_to_list(cur)
    for s in top_shops:
        if s.get('avg_total') is not None:
            s['avg_total'] = float(s['avg_total'])

    cur.execute("""
        SELECT r.*, s.name as shop_name, s.area as shop_area
        FROM reviews r JOIN shops s ON r.shop_id = s.id
        ORDER BY r.created_at DESC LIMIT 5
    """)
    latest_reviews = rows_to_list(cur)
    for r in latest_reviews:
        parse_image_urls(r)

    cur.execute("""
        SELECT s.area, COUNT(DISTINCT s.id) as shop_count, COUNT(r.id) as review_count,
            ROUND((AVG(r.noodle_score) + AVG(r.broth_score) + AVG(r.topping_score) + AVG(r.value_score) + AVG(r.atmosphere_score))::numeric / 5.0, 2) as avg_total
        FROM shops s LEFT JOIN reviews r ON s.id = r.shop_id
        WHERE s.area != '' GROUP BY s.area ORDER BY avg_total DESC
    """)
    area_stats = rows_to_list(cur)
    for a in area_stats:
        if a.get('avg_total') is not None:
            a['avg_total'] = float(a['avg_total'])

    cur.execute("""
        SELECT udon_type, COUNT(*) as count,
            ROUND((AVG(noodle_score) + AVG(broth_score) + AVG(topping_score) + AVG(value_score) + AVG(atmosphere_score))::numeric / 5.0, 2) as avg_total
        FROM reviews WHERE udon_type != '' GROUP BY udon_type ORDER BY count DESC
    """)
    udon_type_stats = rows_to_list(cur)
    for u in udon_type_stats:
        if u.get('avg_total') is not None:
            u['avg_total'] = float(u['avg_total'])

    cur.close()
    conn.close()
    return jsonify({
        'totals': totals,
        'topShops': top_shops,
        'latestReviews': latest_reviews,
        'areaStats': area_stats,
        'udonTypeStats': udon_type_stats
    })

@app.route('/api/stats/user/<username>', methods=['GET'])
def get_user_stats(username):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT r.*, s.name as shop_name, s.area as shop_area
        FROM reviews r JOIN shops s ON r.shop_id = s.id
        WHERE r.username = %s ORDER BY r.created_at DESC
    """, (username,))
    reviews = rows_to_list(cur)

    if not reviews:
        cur.close()
        conn.close()
        return jsonify({'error': '\u3053\u306e\u30e6\u30fc\u30b6\u30fc\u306e\u30ec\u30d3\u30e5\u30fc\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093'}), 404

    for r in reviews:
        parse_image_urls(r)

    cur.execute("""
        SELECT
            COUNT(*) as review_count,
            COUNT(DISTINCT shop_id) as shops_visited,
            ROUND(AVG(noodle_score)::numeric, 1) as avg_noodle,
            ROUND(AVG(broth_score)::numeric, 1) as avg_broth,
            ROUND(AVG(topping_score)::numeric, 1) as avg_topping,
            ROUND(AVG(value_score)::numeric, 1) as avg_value,
            ROUND(AVG(atmosphere_score)::numeric, 1) as avg_atmosphere,
            ROUND((AVG(noodle_score) + AVG(broth_score) + AVG(topping_score) + AVG(value_score) + AVG(atmosphere_score))::numeric / 5.0, 2) as avg_total
        FROM reviews WHERE username = %s
    """, (username,))
    stats = row_to_dict(cur)
    for k in ['avg_total','avg_noodle','avg_broth','avg_topping','avg_value','avg_atmosphere']:
        if stats.get(k) is not None:
            stats[k] = float(stats[k])

    cur.execute("""
        SELECT udon_type, COUNT(*) as count
        FROM reviews WHERE username = %s AND udon_type != ''
        GROUP BY udon_type ORDER BY count DESC
    """, (username,))
    favorite_types = rows_to_list(cur)

    cur.execute("""
        SELECT s.id, s.name, s.area, COUNT(*) as visit_count
        FROM reviews r JOIN shops s ON r.shop_id = s.id
        WHERE r.username = %s GROUP BY s.id, s.name, s.area ORDER BY visit_count DESC LIMIT 5
    """, (username,))
    frequent_shops = rows_to_list(cur)

    cur.close()
    conn.close()
    return jsonify({
        'username': username,
        'stats': stats,
        'reviews': reviews,
        'favoriteTypes': favorite_types,
        'frequentShops': frequent_shops
    })

@app.route('/api/users', methods=['GET'])
def get_users():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT username, COUNT(*) as review_count
        FROM reviews GROUP BY username ORDER BY review_count DESC
    """)
    users = rows_to_list(cur)
    cur.close()
    conn.close()
    return jsonify(users)

# ─── Image Upload ────────────────────────────────────────
@app.route('/api/uploads', methods=['POST'])
def upload_images():
    images = request.files.getlist('images')[:3]
    urls = save_uploaded_images(images)
    return jsonify({'urls': urls})

# ─── SPA Fallback ────────────────────────────────────────
@app.route('/')
def index():
    return send_file(os.path.join(BASE_DIR, 'public', 'index.html'))

@app.route('/<path:path>')
def catch_all(path):
    static_path = os.path.join(BASE_DIR, 'public', path)
    if os.path.isfile(static_path):
        return send_from_directory(os.path.join(BASE_DIR, 'public'), path)
    return send_file(os.path.join(BASE_DIR, 'public', 'index.html'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f'[UDON] Sanuki Udon Review running at http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=True)
