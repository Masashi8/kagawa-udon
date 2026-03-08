// ─── App State ─────────────────────────────────────────
const state = {
  currentPage: 'overview',
  shops: [],
  selectedFiles: [],
};

// ─── Helpers ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showToast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 3000);
}

async function api(url, opts) {
  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    return data;
  } catch (e) {
    showToast(e.message, true);
    throw e;
  }
}

function scoreColor(score) {
  if (score >= 4.5) return '#4ade80';
  if (score >= 3.5) return '#e8a838';
  if (score >= 2.5) return '#f0c060';
  return '#f87171';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`;
}

function bowlsHtml(score) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span style="filter:${i <= score ? 'none' : 'grayscale(1) opacity(0.2)'}; font-size:0.9rem;">🍜</span>`;
  }
  return s;
}

// ─── Navigation ────────────────────────────────────────
function navigateTo(page) {
  state.currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  const target = $(`#page-${page}`);
  if (target) target.classList.add('active');

  $$('.nav-link').forEach(l => {
    l.classList.remove('active');
    if (l.dataset.page === page) l.classList.add('active');
  });

  // Close mobile menu
  $('#mobile-menu').classList.remove('open');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load page data
  switch (page) {
    case 'overview': loadOverview(); break;
    case 'shops': loadShops(); break;
    case 'review': loadReviewForm(); break;
    case 'users': loadUsers(); break;
  }
}

// Nav click handlers
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-page]');
  if (link) {
    e.preventDefault();
    navigateTo(link.dataset.page);
  }
});

$('#nav-hamburger').addEventListener('click', () => {
  $('#mobile-menu').classList.toggle('open');
});

// ─── Overview Page ─────────────────────────────────────
async function loadOverview() {
  try {
    const data = await api('/api/stats/overview');

    // Hero stats
    $('#hero-stats').innerHTML = `
      <div class="hero-stat"><div class="stat-num">${data.totals.total_shops}</div><div class="stat-label">登録店舗</div></div>
      <div class="hero-stat"><div class="stat-num">${data.totals.total_reviews}</div><div class="stat-label">レビュー数</div></div>
      <div class="hero-stat"><div class="stat-num">${data.totals.total_users}</div><div class="stat-label">レビュアー</div></div>
    `;

    // Top shops
    if (data.topShops.length === 0) {
      $('#top-shops-list').innerHTML = '<div class="empty-state"><span class="empty-icon">🍜</span>まだレビューがありません</div>';
    } else {
      $('#top-shops-list').innerHTML = data.topShops.map((s, i) => `
        <div class="ranking-item" onclick="showShopDetail(${s.id})">
          <div class="ranking-pos ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i+1}</div>
          <div class="ranking-info">
            <div class="ranking-name">${escHtml(s.name)}</div>
            <div class="ranking-area">${escHtml(s.area)} · ${s.review_count}件</div>
          </div>
          <div class="ranking-score">${s.avg_total || '-'}</div>
        </div>
      `).join('');
    }

    // Latest reviews
    if (data.latestReviews.length === 0) {
      $('#latest-reviews-list').innerHTML = '<div class="empty-state"><span class="empty-icon">✍️</span>まだレビューがありません</div>';
    } else {
      $('#latest-reviews-list').innerHTML = data.latestReviews.map(r => reviewCardHtml(r)).join('');
    }

    // Area stats
    if (data.areaStats.length === 0) {
      $('#area-stats-list').innerHTML = '<div class="empty-state">データなし</div>';
    } else {
      $('#area-stats-list').innerHTML = data.areaStats.map(a => `
        <div class="stats-row">
          <div class="stats-row-name">📍 ${escHtml(a.area)}</div>
          <div class="stats-row-count">${a.shop_count}店 / ${a.review_count}件</div>
          <div class="stats-row-val">${a.avg_total || '-'}</div>
        </div>
      `).join('');
    }

    // Udon type stats
    if (data.udonTypeStats.length === 0) {
      $('#udon-type-stats-list').innerHTML = '<div class="empty-state">データなし</div>';
    } else {
      $('#udon-type-stats-list').innerHTML = data.udonTypeStats.map(u => `
        <div class="stats-row">
          <div class="stats-row-name">🍜 ${escHtml(u.udon_type)}</div>
          <div class="stats-row-count">${u.count}件</div>
          <div class="stats-row-val">${u.avg_total || '-'}</div>
        </div>
      `).join('');
    }
  } catch (e) { /* toast already shown */ }
}

// ─── Shops Page ────────────────────────────────────────
async function loadShops() {
  try {
    state.shops = await api('/api/shops');
    renderShops(state.shops);
    populateAreaFilter(state.shops);
  } catch (e) { /* */ }
}

function renderShops(shops) {
  if (shops.length === 0) {
    $('#shops-grid').innerHTML = '<div class="empty-state"><span class="empty-icon">🏪</span>まだ店舗が登録されていません<br>レビュー投稿ページから追加できます</div>';
    return;
  }
  $('#shops-grid').innerHTML = shops.map(s => {
    const scores = [
      { label: '🍝 麺', val: s.avg_noodle },
      { label: '🫕 出汁', val: s.avg_broth },
      { label: '🍤 トッピング', val: s.avg_topping },
      { label: '💰 コスパ', val: s.avg_value },
      { label: '🏠 雰囲気', val: s.avg_atmosphere },
    ];
    return `
      <div class="shop-card" onclick="showShopDetail(${s.id})">
        <div class="shop-card-header">
          <div>
            <div class="shop-card-name">${escHtml(s.name)}</div>
            ${s.area ? `<span class="shop-card-area">${escHtml(s.area)}</span>` : ''}
          </div>
          <div class="shop-card-score">${s.avg_total || '-'}<small>/5</small></div>
        </div>
        <div class="shop-card-bars">
          ${scores.map(sc => `
            <div class="mini-bar-row">
              <div class="mini-bar-label">${sc.label}</div>
              <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${(sc.val||0)/5*100}%; background:${scoreColor(sc.val||0)}"></div></div>
              <div class="mini-bar-val">${sc.val || '-'}</div>
            </div>
          `).join('')}
        </div>
        <div class="shop-card-reviews">${s.review_count} 件のレビュー</div>
      </div>
    `;
  }).join('');
}

function populateAreaFilter(shops) {
  const areas = [...new Set(shops.map(s => s.area).filter(Boolean))].sort();
  const sel = $('#shop-area-filter');
  sel.innerHTML = '<option value="">全エリア</option>' + areas.map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
}

// Shop search & filter
$('#shop-search').addEventListener('input', filterShops);
$('#shop-area-filter').addEventListener('change', filterShops);

function filterShops() {
  const q = $('#shop-search').value.toLowerCase();
  const area = $('#shop-area-filter').value;
  const filtered = state.shops.filter(s =>
    (!q || s.name.toLowerCase().includes(q)) &&
    (!area || s.area === area)
  );
  renderShops(filtered);
}

// ─── Shop Detail ───────────────────────────────────────
async function showShopDetail(id) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-shop-detail').classList.add('active');
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });

  $('#shop-detail-content').innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await api(`/api/shops/${id}`);
    const { shop, stats, reviews, udonTypes } = data;

    const scoreItems = [
      { label: '🍝 麺', key: 'avg_noodle' },
      { label: '🫕 出汁', key: 'avg_broth' },
      { label: '🍤 トッピング', key: 'avg_topping' },
      { label: '💰 コスパ', key: 'avg_value' },
      { label: '🏠 雰囲気', key: 'avg_atmosphere' },
    ];

    const radarData = scoreItems.map(si => stats[si.key] || 0);

    let html = `
      <div class="shop-detail-header">
        <div class="shop-detail-name">${escHtml(shop.name)}</div>
        <div class="shop-detail-area">📍 ${escHtml(shop.area || '未設定')}</div>
        <div class="shop-detail-total">${stats.avg_total || '-'}<small> / 5.00</small></div>
        <div style="font-size:0.85rem; color:var(--text-muted)">${stats.review_count} 件のレビュー</div>
      </div>

      <div class="grid-2">
        <div class="section-card">
          <h2>📊 評価チャート</h2>
          <div class="radar-container"><canvas id="radar-canvas" width="260" height="260"></canvas></div>
          <div class="score-bars">
            ${scoreItems.map(si => `
              <div class="score-bar-row">
                <div class="score-bar-label">${si.label}</div>
                <div class="score-bar-track"><div class="score-bar-fill" style="width:${(stats[si.key]||0)/5*100}%"></div></div>
                <div class="score-bar-val">${stats[si.key] || '-'}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="section-card">
          <h2>🍜 うどんタイプ別</h2>
          ${udonTypes.length === 0 ? '<div class="empty-state">データなし</div>' :
            udonTypes.map(u => `
              <div class="stats-row">
                <div class="stats-row-name">${escHtml(u.udon_type)}</div>
                <div class="stats-row-count">${u.count}件</div>
              </div>
            `).join('')}
        </div>
      </div>

      <div class="section-card" style="margin-top:1.5rem">
        <h2>📝 レビュー一覧 (${reviews.length}件)</h2>
        ${reviews.length === 0 ? '<div class="empty-state">まだレビューがありません</div>' :
          reviews.map(r => reviewCardHtml(r, false)).join('')}
      </div>
    `;

    $('#shop-detail-content').innerHTML = html;

    // Draw radar chart
    setTimeout(() => drawRadar(radarData, scoreItems.map(s => s.label)), 100);

  } catch (e) { /* */ }
}

$('#btn-back-shops').addEventListener('click', () => navigateTo('shops'));

// ─── Radar Chart (Canvas) ──────────────────────────────
function drawRadar(values, labels) {
  const canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, R = 100;
  const n = values.length;

  ctx.clearRect(0, 0, W, H);

  // Draw grid
  for (let level = 1; level <= 5; level++) {
    const r = R * level / 5;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,200,100,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw axes
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle));
    ctx.strokeStyle = 'rgba(255,200,100,0.15)';
    ctx.stroke();
  }

  // Draw data
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const angle = (Math.PI * 2 * idx / n) - Math.PI / 2;
    const r = R * (values[idx] || 0) / 5;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(232,168,56,0.2)';
  ctx.fill();
  ctx.strokeStyle = '#e8a838';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw points and labels
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const r = R * (values[i] || 0) / 5;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a838';
    ctx.fill();

    // Label
    const lx = cx + (R + 22) * Math.cos(angle);
    const ly = cy + (R + 22) * Math.sin(angle);
    ctx.fillStyle = '#a09b8e';
    ctx.font = '11px "Noto Sans JP"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[i], lx, ly);
  }
}

// ─── Review Card HTML ──────────────────────────────────
function reviewCardHtml(r, showShop = true) {
  const avg = ((r.noodle_score + r.broth_score + r.topping_score + r.value_score + r.atmosphere_score) / 5).toFixed(1);
  const images = Array.isArray(r.image_urls) ? r.image_urls : [];

  return `
    <div class="review-card">
      <div class="review-card-header">
        <div>
          ${showShop ? `<div class="review-shop-name" onclick="showShopDetail(${r.shop_id})">${escHtml(r.shop_name || '')}</div>` : ''}
          <span class="review-username" onclick="showUserDetail('${escAttr(r.username)}')">${escHtml(r.username)}</span>
          ${r.udon_type ? `<span class="review-udon-type">${escHtml(r.udon_type)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <span style="font-weight:900; color:var(--accent); font-size:1.1rem">${avg}</span>
          <span class="review-date">${formatDate(r.created_at)}</span>
          <button class="btn-delete-review" onclick="deleteReview(${r.id})" title="削除">🗑️</button>
        </div>
      </div>
      <div class="review-scores">
        <div class="review-score-item">麺 <span>${r.noodle_score}</span></div>
        <div class="review-score-item">出汁 <span>${r.broth_score}</span></div>
        <div class="review-score-item">トッピング <span>${r.topping_score}</span></div>
        <div class="review-score-item">コスパ <span>${r.value_score}</span></div>
        <div class="review-score-item">雰囲気 <span>${r.atmosphere_score}</span></div>
      </div>
      ${r.comment ? `<div class="review-comment">${escHtml(r.comment)}</div>` : ''}
      ${images.length > 0 ? `
        <div class="review-images">
          ${images.map(url => `<img src="${escAttr(url)}" class="review-img" onclick="openImageModal('${escAttr(url)}')" alt="うどん写真">`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Review Form ───────────────────────────────────────
async function loadReviewForm() {
  try {
    const shops = await api('/api/shops');
    const sel = $('#review-shop');
    sel.innerHTML = '<option value="">-- お店を選択 --</option>' +
      shops.map(s => `<option value="${s.id}">${escHtml(s.name)} ${s.area ? '('+escHtml(s.area)+')' : ''}</option>`).join('');
  } catch (e) { /* */ }

  // Init scores to 3
  $$('.score-row').forEach(row => {
    setScoreValue(row, 3);
  });

  // Clear files
  state.selectedFiles = [];
  $('#image-previews').innerHTML = '';
}

// Score bowl clicks
document.addEventListener('click', (e) => {
  const bowl = e.target.closest('.bowl');
  if (!bowl) return;
  const row = bowl.closest('.score-row');
  const val = parseInt(bowl.dataset.value);
  setScoreValue(row, val);
});

function setScoreValue(row, val) {
  row.querySelectorAll('.bowl').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.value) <= val);
  });
  row.querySelector('.score-value').textContent = val;
}

// Add new shop toggle
$('#btn-add-shop').addEventListener('click', () => {
  $('#new-shop-form').classList.toggle('hidden');
});

// Save new shop
$('#btn-save-shop').addEventListener('click', async () => {
  const name = $('#new-shop-name').value.trim();
  const area = $('#new-shop-area').value;
  if (!name) { showToast('店名を入力してください', true); return; }

  try {
    const shop = await api('/api/shops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, area })
    });

    // Add to dropdown and select
    const sel = $('#review-shop');
    const opt = document.createElement('option');
    opt.value = shop.id;
    opt.textContent = `${shop.name} ${shop.area ? '('+shop.area+')' : ''}`;
    sel.appendChild(opt);
    sel.value = shop.id;

    // Hide form and clear
    $('#new-shop-form').classList.add('hidden');
    $('#new-shop-name').value = '';
    $('#new-shop-area').value = '';

    showToast(`${shop.name} を登録しました！`);
  } catch (e) { /* */ }
});

// Image upload
$('#btn-upload').addEventListener('click', () => {
  $('#image-input').click();
});

$('#image-input').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (state.selectedFiles.length + files.length > 3) {
    showToast('画像は最大3枚までです', true);
    return;
  }
  files.forEach(f => {
    if (state.selectedFiles.length >= 3) return;
    state.selectedFiles.push(f);
  });
  renderImagePreviews();
  e.target.value = '';
});

function renderImagePreviews() {
  const container = $('#image-previews');
  container.innerHTML = '';
  state.selectedFiles.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'preview-item';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.alt = 'プレビュー';
    const btn = document.createElement('button');
    btn.className = 'preview-remove';
    btn.innerHTML = '✕';
    btn.onclick = () => {
      state.selectedFiles.splice(i, 1);
      renderImagePreviews();
    };
    div.appendChild(img);
    div.appendChild(btn);
    container.appendChild(div);
  });
}

// Submit review
$('#review-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const shop_id = $('#review-shop').value;
  const username = $('#review-username').value.trim();
  if (!shop_id) { showToast('お店を選択してください', true); return; }
  if (!username) { showToast('ユーザー名を入力してください', true); return; }

  const formData = new FormData();
  formData.append('shop_id', shop_id);
  formData.append('username', username);

  // Get scores
  $$('.score-row').forEach(row => {
    const field = row.dataset.field;
    const val = row.querySelector('.score-value').textContent;
    formData.append(field, val);
  });

  // Udon type
  const udonType = document.querySelector('input[name="udon_type"]:checked');
  formData.append('udon_type', udonType ? udonType.value : '');
  formData.append('comment', $('#review-comment').value);

  // Images
  state.selectedFiles.forEach(f => formData.append('images', f));

  const btn = $('#btn-submit-review');
  btn.disabled = true;
  btn.textContent = '投稿中...';

  try {
    await api('/api/reviews', { method: 'POST', body: formData });
    showToast('レビューを投稿しました！🍜');

    // Reset form
    $('#review-form').reset();
    state.selectedFiles = [];
    $('#image-previews').innerHTML = '';
    $$('.score-row').forEach(row => setScoreValue(row, 3));

    // Navigate to overview
    setTimeout(() => navigateTo('overview'), 1000);
  } catch (e) { /* */ } finally {
    btn.disabled = false;
    btn.textContent = '🍜 レビューを投稿する';
  }
});

// ─── Users Page ────────────────────────────────────────
async function loadUsers() {
  $('#user-detail-content').classList.add('hidden');
  $('#users-list').classList.remove('hidden');

  try {
    const users = await api('/api/users');
    if (users.length === 0) {
      $('#users-list').innerHTML = '<div class="empty-state"><span class="empty-icon">👤</span>まだレビュアーがいません</div>';
      return;
    }
    renderUsersList(users);

    $('#user-search').oninput = () => {
      const q = $('#user-search').value.toLowerCase();
      const filtered = users.filter(u => u.username.toLowerCase().includes(q));
      renderUsersList(filtered);
    };
  } catch (e) { /* */ }
}

function renderUsersList(users) {
  $('#users-list').innerHTML = users.map(u => `
    <div class="user-card" onclick="showUserDetail('${escAttr(u.username)}')">
      <div class="user-card-name">${escHtml(u.username)}</div>
      <div class="user-card-count">${u.review_count} 件のレビュー</div>
    </div>
  `).join('');
}

// ─── User Detail ───────────────────────────────────────
async function showUserDetail(username) {
  // Show on users page
  if (state.currentPage !== 'users') {
    navigateTo('users');
    await new Promise(r => setTimeout(r, 100));
  }

  $('#users-list').classList.add('hidden');
  const container = $('#user-detail-content');
  container.classList.remove('hidden');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await api(`/api/stats/user/${encodeURIComponent(username)}`);
    const { stats, reviews, favoriteTypes, frequentShops } = data;

    const scoreItems = [
      { label: '🍝 麺', key: 'avg_noodle' },
      { label: '🫕 出汁', key: 'avg_broth' },
      { label: '🍤 トッピング', key: 'avg_topping' },
      { label: '💰 コスパ', key: 'avg_value' },
      { label: '🏠 雰囲気', key: 'avg_atmosphere' },
    ];

    container.innerHTML = `
      <button class="btn-back" onclick="loadUsers()">← ユーザー一覧に戻る</button>
      <div class="user-detail-header">
        <div class="user-detail-name">👤 ${escHtml(username)}</div>
        <div style="color:var(--text-muted);margin-top:0.5rem">${stats.review_count}件のレビュー · ${stats.shops_visited}店舗訪問</div>
        <div style="font-size:2rem;font-weight:900;color:var(--accent);margin-top:0.75rem">${stats.avg_total}<small style="font-size:0.9rem;color:var(--text-muted);font-weight:400"> 平均</small></div>
      </div>

      <div class="grid-2">
        <div class="section-card">
          <h2>📊 平均スコア</h2>
          <div class="score-bars">
            ${scoreItems.map(si => `
              <div class="score-bar-row">
                <div class="score-bar-label">${si.label}</div>
                <div class="score-bar-track"><div class="score-bar-fill" style="width:${(stats[si.key]||0)/5*100}%"></div></div>
                <div class="score-bar-val">${stats[si.key] || '-'}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="section-card">
          <h2>❤️ お気に入り</h2>
          ${favoriteTypes.length > 0 ? `
            <h3 style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem">うどんタイプ</h3>
            ${favoriteTypes.map(t => `
              <div class="stats-row">
                <div class="stats-row-name">${escHtml(t.udon_type)}</div>
                <div class="stats-row-count">${t.count}回</div>
              </div>
            `).join('')}
          ` : ''}
          ${frequentShops.length > 0 ? `
            <h3 style="font-size:0.85rem;color:var(--text-muted);margin:1rem 0 0.5rem">よく行くお店</h3>
            ${frequentShops.map(s => `
              <div class="stats-row" style="cursor:pointer" onclick="showShopDetail(${s.id})">
                <div class="stats-row-name">${escHtml(s.name)}</div>
                <div class="stats-row-count">${s.visit_count}回</div>
              </div>
            `).join('')}
          ` : ''}
        </div>
      </div>

      <div class="section-card" style="margin-top:1.5rem">
        <h2>📝 レビュー履歴 (${reviews.length}件)</h2>
        ${reviews.map(r => reviewCardHtml(r, true)).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">😔</span>ユーザーが見つかりません</div>';
  }
}

// ─── Image Modal ───────────────────────────────────────
function openImageModal(url) {
  $('#modal-image').src = url;
  $('#image-modal').classList.add('show');
}
$('#modal-close').addEventListener('click', () => {
  $('#image-modal').classList.remove('show');
});
$('#image-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('#image-modal').classList.remove('show');
});

// ─── Delete Review ─────────────────────────────────────
async function deleteReview(id) {
  if (!confirm('このレビューを削除しますか？この操作は取り消せません。')) return;
  try {
    await api(`/api/reviews/${id}`, { method: 'DELETE' });
    showToast('レビューを削除しました');
    // Reload current page
    switch (state.currentPage) {
      case 'overview': loadOverview(); break;
      case 'shops': loadShops(); break;
      default:
        // If on shop detail or user detail, reload by re-navigating
        const shopDetail = document.querySelector('#page-shop-detail.active');
        if (shopDetail) {
          // Re-trigger current shop detail
          const nameEl = shopDetail.querySelector('.shop-detail-name');
          if (nameEl) location.reload();
        } else {
          navigateTo(state.currentPage);
        }
    }
  } catch (e) { /* toast shown */ }
}

// ─── Escape Helpers ────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ─── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('overview');
});
