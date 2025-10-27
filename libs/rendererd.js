const renderer = require('syzoj-renderer');
const XSS = require('xss');
const xssWhiteList = Object.assign({}, require('xss/lib/default').whiteList);
delete xssWhiteList.audio;
delete xssWhiteList.video;

for (const tag in xssWhiteList) {
  xssWhiteList[tag] = xssWhiteList[tag].concat(['style', 'class']);
}

const xss = new XSS.FilterXSS({
  whiteList: xssWhiteList,
  stripIgnoreTag: true,
  onTagAttr: (tag, name, value, isWhiteAttr) => {
    if (tag.toLowerCase() === 'img' && name.toLowerCase() === 'src' && value.startsWith('data:image/')) {
      return name + '="' + XSS.escapeAttrValue(value) + '"';
    }
  }
});

const LRUCache = require('lru-cache');
const cache = new LRUCache({ max: parseInt(process.argv[2]) });

async function highlight(code, lang) {
  // Normalize input for highlighter: ensure string and unify line endings to LF
  try {
    if (code == null) code = '';
    if (code instanceof Buffer) code = code.toString('utf8');
    if (typeof code !== 'string') code = String(code);
    // Convert CRLF and CR to LF to avoid extra visual newlines in highlighted HTML
    code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  } catch (e) {
    // If normalization fails for any reason, fall back to best-effort string
    try { code = String(code); } catch (_) { code = ''; }
  }

  return await renderer.highlight(code, lang, cache, {
    wrapper: null
  });
}

async function markdown(markdownCode) {
  function filter(html) {
    html = xss.process(html);
    if (html) {
      // Add a class to inline code (code elements not inside pre)
      try {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html, { decodeEntities: false });
        $('code').each(function () {
          if ($(this).parents('pre').length === 0) {
            $(this).addClass('md-inline-code');
          }
        });
        html = $.html();
      } catch (e) {
        // If cheerio is unavailable for any reason, fall back silently
      }

      html = `<div style="position: relative; overflow: hidden; transform: translate3d(0, 0, 0); ">${html}</div>`;
    }
    return html;
  };

  return await renderer.markdown(markdownCode, cache, filter);
}

process.on('message', async msg => {
  if (msg.type === 'markdown') {
    process.send({
      id: msg.id,
      result: await markdown(msg.source)
    });
  } else if (msg.type === 'highlight') {
    process.send({
      id: msg.id,
      result: await highlight(msg.source.code, msg.source.lang)
    });
  }
});

process.on('disconnect', () => process.exit());
