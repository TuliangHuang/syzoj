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
});

document.addEventListener('DOMContentLoaded', () => {
  const codeBlocks = document.querySelectorAll('pre');

  codeBlocks.forEach((block) => {
    // 创建包装器
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    // 克隆代码块并添加到包装器中
    const clonedBlock = block.cloneNode(true);
    wrapper.appendChild(clonedBlock);

    // 创建按钮
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.type = 'button';
    button.innerText = '复制';

    // 添加按钮到包装器中
    wrapper.appendChild(button);

    // 替换原始代码块为包装器
    block.parentNode.replaceChild(wrapper, block);

    // 绑定点击事件
    button.addEventListener('click', async () => {
      const code = wrapper.querySelector('code');
      const text = code.innerText;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // 创建一个隐藏的 textarea 元素
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        button.innerText = '已复制';
        setTimeout(() => {
          button.innerText = '复制';
        }, 5000);
      } catch (err) {
        console.error('复制失败:', err);
        button.innerText = '复制失败';
        setTimeout(() => {
          button.innerText = '复制';
        }, 5000);
      }
    });
  });
});
