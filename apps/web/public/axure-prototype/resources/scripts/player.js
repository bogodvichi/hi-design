// resources/scripts/player.js
// 读取 data/document.js 的 document_data，构建站点地图，并处理 iframe 导航。
(function () {
  var data = window.document_data || { pages: [] };
  var tree = document.getElementById('sitemapTree');
  var frame = document.getElementById('mainFrame');
  var toggle = document.getElementById('sitemapToggle');
  var body = document.body;
  var pageCount = document.getElementById('pageCount');
  var search = document.getElementById('sitemapSearch');

  function countPages(pages) {
    var n = 0;
    (pages || []).forEach(function (p) { n += 1; n += countPages(p.children); });
    return n;
  }
  if (pageCount) pageCount.textContent = countPages(data.pages) + ' 页';

  function flatten(pages, out) {
    out = out || [];
    (pages || []).forEach(function (p) { out.push(p); flatten(p.children, out); });
    return out;
  }
  var all = flatten(data.pages);

  function setActive(id) {
    Array.prototype.forEach.call(tree.querySelectorAll('.sitemap-item'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-id') === id);
    });
  }

  function navigate(page) {
    if (!page || !page.file) return;
    frame.src = page.file;
    setActive(page.id);
    // 让 iframe 内脚本知道当前页 id（用于页面间跳转后同步站点地图）
    try { frame.dataset.pageId = page.id; } catch (e) {}
  }
  window.__axureNavigate = function (id) {
    var p = all.filter(function (x) { return x.id === id; })[0];
    if (p) navigate(p);
  };

  function buildNode(page, depth) {
    var row = document.createElement('div');
    row.className = 'sitemap-item';
    row.setAttribute('data-id', page.id);
    row.style.paddingLeft = (8 + depth * 14) + 'px';

    var tw = document.createElement('span');
    tw.className = 'sitemap-twisty';
    tw.textContent = page.children && page.children.length ? '▾' : '';
    row.appendChild(tw);

    var label = document.createElement('span');
    label.className = 'sitemap-page';
    label.textContent = page.name;
    row.appendChild(label);

    row.addEventListener('click', function (e) {
      e.stopPropagation();
      if (page.file) navigate(page);
    });

    var wrapper = document.createElement('div');
    wrapper.appendChild(row);

    if (page.children && page.children.length) {
      var childWrap = document.createElement('div');
      childWrap.className = 'sitemap-children';
      page.children.forEach(function (c) { childWrap.appendChild(buildNode(c, depth + 1)); });
      wrapper.appendChild(childWrap);
      tw.addEventListener('click', function (e) {
        e.stopPropagation();
        var hidden = childWrap.style.display === 'none';
        childWrap.style.display = hidden ? '' : 'none';
        tw.textContent = hidden ? '▾' : '▸';
      });
    }
    return wrapper;
  }

  data.pages.forEach(function (p) { tree.appendChild(buildNode(p, 0)); });

  // 站点地图开关
  toggle.addEventListener('click', function () {
    body.classList.toggle('sitemap-hidden');
    toggle.classList.toggle('is-active', !body.classList.contains('sitemap-hidden'));
  });

  // 搜索过滤
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    Array.prototype.forEach.call(tree.querySelectorAll('.sitemap-item'), function (el) {
      var match = el.textContent.toLowerCase().indexOf(q) !== -1;
      el.style.display = match ? '' : 'none';
    });
  });

  // 拖拽调整左侧栏宽度
  (function () {
    var resizer = document.getElementById('resizer');
    var panel = document.getElementById('sitemapPanel');
    var dragging = false;
    resizer.addEventListener('mousedown', function (e) {
      dragging = true; resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var w = Math.min(420, Math.max(180, e.clientX));
      panel.style.width = w + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
    });
  })();

  setActive('login');
})();
