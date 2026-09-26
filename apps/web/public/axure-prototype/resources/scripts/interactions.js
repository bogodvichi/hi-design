// resources/scripts/interactions.js
// 在 iframe 内页面中提供轻量交互：弹窗、标签页、导航到其他原型页。
(function () {
  // 在 player 中切换页面（与父窗口 player.js 的 __axureNavigate 对接）
  window.__navTo = function (id) {
    if (window.parent && window.parent.__axureNavigate) {
      window.parent.__axureNavigate(id);
    } else {
      // 独立打开页面时退化为直接跳转
      var map = {
        login: '../login/page.html',
        dashboard: '../dashboard/page.html',
        taskdetail: '../taskdetail/page.html',
        settings: '../settings/page.html'
      };
      if (map[id]) window.location.href = map[id];
    }
  };

  // 弹窗（open / close）
  window.__openModal = function (selector) {
    var el = document.querySelector(selector);
    if (el) { el.classList.add('is-open'); document.body.classList.add('modal-open'); }
  };
  window.__closeModal = function (selector) {
    var el = document.querySelector(selector);
    if (el) { el.classList.remove('is-open'); document.body.classList.remove('modal-open'); }
  };

  // 标签页切换（data-tab 容器 + data-tab-target 面板）
  window.__switchTab = function (trigger) {
    var group = trigger.closest('[data-tabs]');
    if (!group) return;
    var target = trigger.getAttribute('data-tab-target');
    Array.prototype.forEach.call(group.querySelectorAll('[data-tab-target]'), function (t) {
      t.classList.toggle('is-active', t === trigger);
    });
    Array.prototype.forEach.call(group.querySelectorAll('[data-tab-panel]'), function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-tab-panel') === target);
    });
  };

  // 关闭告警/通知
  window.__dismiss = function (el) {
    var node = el.closest('.alert') || el.closest('.notice');
    if (node) node.classList.add('is-hidden');
  };

  document.addEventListener('DOMContentLoaded', function () {
    // 通用：[data-action="nav"] 跳转
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="nav"]'), function (el) {
      el.addEventListener('click', function () { window.__navTo(el.getAttribute('data-target')); });
    });
    // 通用：[data-action="open-modal"]
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="open-modal"]'), function (el) {
      el.addEventListener('click', function () { window.__openModal(el.getAttribute('data-target')); });
    });
    // 通用：[data-action="close-modal"]
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="close-modal"]'), function (el) {
      el.addEventListener('click', function () { window.__closeModal(el.getAttribute('data-target')); });
    });
    // 通用：标签触发
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab-target]'), function (el) {
      el.addEventListener('click', function () { window.__switchTab(el); });
    });
    // 通用：[data-action="dismiss"]
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="dismiss"]'), function (el) {
      el.addEventListener('click', function () { window.__dismiss(el); });
    });
  });
})();
