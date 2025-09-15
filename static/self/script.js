var addUrlParam = function (url, key, val) {
  var newParam = encodeURIComponent(key) + '=' + encodeURIComponent(val);

  url = url.split('#')[0];
  var twoPart = url.split('?'), params = {};
  var tmp = twoPart[1] ? twoPart[1].split('&') : [];
  for (var i in tmp) {
    var a = tmp[i].split('=');
    params[a[0]] = a[1];
  }

  params[key] = val;

  url = twoPart[0] + '?';
  for (var key2 in params) {
    url += encodeURIComponent(key2) + '=' + encodeURIComponent(params[key2]) + '&';
  }

  url = url.substring(0, url.length - 1);

  return url;
};

$(function () {
  $(document).on('click', 'a[href-post]', function (e) {
    e.preventDefault();

    var form = document.createElement('form');
    form.style.display = 'none';
    form.method = 'post';
    form.action = $(this).attr('href-post');
    form.target = '_self';

    document.body.appendChild(form);
    form.submit();
  });

  // Global: Submit nearest form when pressing Cmd/Ctrl + Enter inside any textarea on edit pages
  $(document).on('keydown', 'textarea', function (e) {
    // Heuristic: only on URLs ending with '/edit' or containing '/edit?'
    try {
      var href = window.location.pathname || '';
      var isEditPage = /\/(edit)(?:$|[\/\?])/.test(href) || /_edit(?:$|[\/\?])/.test(href);
      if (!isEditPage) return;
    } catch (err) {}
    if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault();
      var $form = $(this).closest('form');
      if ($form.length) $form.submit();
    }
  });
});
