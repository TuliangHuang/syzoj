Array.prototype.forEachAsync = Array.prototype.mapAsync = async function (fn) {
  return Promise.all(this.map(fn));
};

Array.prototype.filterAsync = async function (fn) {
  let a = await this.mapAsync(fn);
  return this.filter((x, i) => a[i]);
};

global.ErrorMessage = class ErrorMessage {
  constructor(message, nextUrls, details) {
    this.message = message;
    this.nextUrls = nextUrls || {};
    this.details = details;
  }
};

let Promise = require('bluebird');
let path = require('path');
let fs = Promise.promisifyAll(require('fs-extra'));
let util = require('util');
let moment = require('moment-timezone');
let { fromZonedTime } = require('date-fns-tz');
let url = require('url');
let querystring = require('querystring');
let gravatar = require('gravatar');
let filesize = require('file-size');
let AsyncLock = require('async-lock');
let JSDOM = require('jsdom').JSDOM;
let renderer = require('./libs/renderer');

module.exports = {
  resolvePath(s) {
    let a = Array.from(arguments);
    a.unshift(__dirname);
    return path.resolve.apply(null, a);
  },
  markdown(obj, keys, noReplaceUI) {
    let replaceUI = s => {
      if (noReplaceUI) return s;

      s = s.split('<pre>').join('<div class="ui existing segment"><pre style="margin-top: 0; margin-bottom: 0; ">').split('</pre>').join('</pre></div>')
           .split('<table>').join('<table class="ui structured celled table">')
           .split('<blockquote>').join('<div class="ui message">').split('</blockquote>').join('</div>');

      let jsdom = new JSDOM(), document = jsdom.window.document;
      document.body.innerHTML = s;

      let a = document.querySelectorAll('p > img:only-child');
      for (let img of Array.from(a)) {
        img.style.display = 'block';
        img.style.margin = '0 auto';
      }

      return document.body.innerHTML;
    };
    return new Promise((resolve, reject) => {
      if (!keys) {
        if (!obj || !obj.trim()) resolve("");
        else renderer.markdown(obj, s => {
            resolve(replaceUI(s));
        });
      } else {
        let res = obj, cnt = keys.length;
        for (let key of keys) {
          renderer.markdown(res[key], (s) => {
            res[key] = replaceUI(s);
            if (!--cnt) resolve(res);
          });
        }
      }
    });
  },
  formatDate(ts, format) {
    if (ts == null) {
      return "Unknown";
    }
    let timezone = 'Asia/Shanghai';
    let m = moment.tz(ts * 1000, timezone);
    m.locale('eu');
    return m.format(format || 'L H:mm:ss');
  },
  formatTime(x) {
    let sgn = x < 0 ? '-' : '';
    x = Math.abs(x);
    function toStringWithPad(x) {
      x = parseInt(x);
      if (x < 10) return '0' + x.toString();
      else return x.toString();
    }
    return sgn + util.format('%s:%s:%s', toStringWithPad(x / 3600), toStringWithPad(x / 60 % 60), toStringWithPad(x % 60));
  },
  formatDuration(x) {
    const sgn = x < 0 ? '-' : '';
    x = Math.abs(x);
    const hours = Math.floor(x / 3600);
    const minutes = x / 60 % 60;
    let duration = sgn;
    if (hours) { duration += hours + " hour" + ((hours > 1) ? 's' : ''); }
    if (minutes) { duration += (hours ? ' ' : '') + minutes + " minute" + ((minutes > 1) ? 's' : ''); }
    if (duration === '') duration = "0 hours";
    return sgn + duration;
  },
  formatSize(x, precision) {
      if (typeof x !== 'number') return '0 B';
      let unit = 'B', units = ['K', 'M', 'G', 'T'];
      for (let i in units) if (x > 1024) x /= 1024, unit = units[i];
      var fixed = x === Math.round(x) ? x.toString() : x.toFixed(precision);
      return fixed + ' ' + unit;
  },
  getFormattedCodeKey(code, lang_format) {
    if (lang_format) {
      return lang_format + '\n' + syzoj.utils.md5(code);
    }
    return null;
  },
  judgeServer(suffix) {
    return JSON.stringify(url.resolve(syzoj.config.judge_server_addr, suffix));
  },
  parseDate(s) {
    let timezone = 'Asia/Shanghai';
    return parseInt(fromZonedTime(new Date(s), timezone) / 1000);
  },
  getCurrentDate(removeTime) {
    let d = new Date;
    if (removeTime) {
      d.setHours(0);
      d.setMinutes(0);
      d.setSeconds(0);
      d.setMilliseconds(0);
    }
    return parseInt(+d / 1000);
  },
  makeUrl(req_params, form) {
    let res = '';
    if (!req_params) res = '/';
    else if (req_params.originalUrl) {
      let u = url.parse(req_params.originalUrl);
      res = u.pathname;
    } else {
      if (!Array.isArray(req_params)) req_params = [req_params];
      for (let param of req_params) res += '/' + param;
    }
    let encoded = querystring.encode(form);
    if (encoded) res += '?' + encoded;
    return res;
  },
  highlight(code, lang) {
    return new Promise((resolve, reject) => {
      renderer.highlight(code, lang, res => {
        resolve(res);
      });
    });
  },
  gravatar(email, size) {
    return gravatar.url(email, { s: size, d: 'mm' }).replace('//www.gravatar.com/avatar', syzoj.config.gravatar_url);
  },
  async parseTestdata(dir, submitAnswer) {
    if (!await syzoj.utils.isDir(dir)) return null;

    try {
      // Get list of *files*
      let list = await (await fs.readdirAsync(dir)).filterAsync(async x => await syzoj.utils.isFile(path.join(dir, x)));

      let res = [];
      if (!list.includes('data.yml')) {
        res[0] = {};
        res[0].cases = [];
        for (let file of list) {
          let parsedName = path.parse(file);
          if (parsedName.ext === '.in') {
            if (list.includes(`${parsedName.name}.out`)) {
              let o = {
                input: file,
                output: `${parsedName.name}.out`
              };
              if (submitAnswer) o.answer = `${parsedName.name}.out`;
              res[0].cases.push(o);
            }

            if (list.includes(`${parsedName.name}.ans`)) {
              let o = {
                input: file,
                output: `${parsedName.name}.ans`
              };
              if (submitAnswer) o.answer = `${parsedName.name}.out`;
              res[0].cases.push(o);
            }
          }
        }

        res[0].type = 'sum';
        res[0].score = 100;
        res[0].cases.forEach((e) => { e.key = (e.input.match(/\d+/g) || []).map((x) => parseInt(x)).concat(e.input); });
        res[0].cases.sort((a, b) => {
          for (let i = 0; i < Math.max(a.key.length, b.key.length); ++i) {
            if (a.key[i] == undefined) return -1;
            if (b.key[i] == undefined) return +1;
            if (a.key[i] !== b.key[i]) return (a.key[i] < b.key[i] ? -1 : +1);
          }
          return 0;
        });

        res.spj = list.some(s => s.startsWith('spj_'));
      } else {
        let config = require('js-yaml').load((await fs.readFileAsync(dir + '/data.yml')));

        let input = config.inputFile, output = config.outputFile, answer = config.userOutput;

        res = config.subtasks.map(st => ({
          score: st.score,
          type: st.type,
          cases: st.cases.map(c => {
            function getFileName(template, id, mustExist) {
              let s = template.split('#').join(String(id));
              if (mustExist && !list.includes(s)) throw `找不到文件 ${s}`;
              return s;
            }

            let o = {};
            if (input) o.input = getFileName(input, c, true);
            if (output) o.output = getFileName(output, c, true);
            if (answer) o.answer = getFileName(answer, c, false);

            return o;
          })
        }));

        res = res.filter(x => x.cases && x.cases.length !== 0);

        res.spj = !!config.specialJudge;
      }

      // 提取 fmt_lang 文件中的语言标识
      const fmts = [];
      for (const file of list) {
        if (file.startsWith('fmt_')) {
          const parsed = path.parse(file);
          const match = parsed.name.match(/^fmt_(\w+)$/);
          if (match) {
            const lang = match[1];
            if (!fmts.includes(lang)) {
              fmts.push(lang);
            }
          }
        }
      }

      // 在返回结果中添加 fmts 属性
      res.fmts = fmts;

      return res;
    } catch (e) {
      console.log(e);
      return { error: e };
    }
  },
  async insertCodeWithIndentation(fmt, code) {
    if (typeof fmt !== 'string' || typeof code !== 'string') return null;

    const placeholderRegex = /\$\{[^}]*\}/;
    const match = fmt.match(placeholderRegex);
    if (!match) return null;

    const index = match.index;

    // 查找占位符所在行的起始位置
    const beforePlaceholder = fmt.slice(0, index);
    const lineStart = beforePlaceholder.lastIndexOf('\n') + 1;
    const line = fmt.slice(lineStart, index);

    // 提取缩进（前导空白字符）
    const indentMatch = line.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0] : '';

    // 处理 code 的每一行，添加缩进
    const codeLines = code.split('\n');
    const indentedImpl = codeLines
      .map((line, i) => (i === 0 ? line : indent + line))
      .join('\n');

    // 替换占位符为处理后的 code
    return fmt.replace(placeholderRegex, indentedImpl);
  },
  ansiToHTML(s) {
    let Convert = require('ansi-to-html');
    let convert = new Convert({ escapeXML: true });
    return convert.toHtml(s);
  },
  paginate(count, currPage, perPage) {
    currPage = parseInt(currPage);
    if (!currPage || currPage < 1) currPage = 1;

    let pageCnt = Math.ceil(count / perPage);
    if (currPage > pageCnt) currPage = pageCnt;

    return {
      currPage: currPage,
      perPage: perPage,
      pageCnt: pageCnt,
      toSQL: () => {
        if (!pageCnt) return '';
        else return ` LIMIT ${(currPage - 1) * perPage},${perPage}`
      }
    };
  },
  paginateFast(currPageTop, currPageBottom, perPage) {
    function parseIntOrNull(x) {
      if (typeof x === 'string') x = parseInt(x);
      if (typeof x !== 'number' || isNaN(x)) return null;
      return x;
    }

    return {
      currPageTop: parseIntOrNull(currPageTop),
      currPageBottom: parseIntOrNull(currPageBottom),
      perPage
    };
  },
  removeTitleTag(s) {
    return s.replace(/「[\S\s]+?」/, '');
  },
  prefixWithLetter(i, str) {
    str = this.removeTitleTag(str);
    const letter = String.fromCharCode(64 + i); // 1:A 2:B, ...
    return `${letter}. ${str}`;
  },
  md5(data) {
    let crypto = require('crypto');
    let md5 = crypto.createHash('md5');
    md5.update(data);
    return md5.digest('hex');
  },
  isValidUsername(s) {
    return RegExp(syzoj.config.username_regex).test(s);
  },
  locks: [],
  lock(key, cb) {
    let s = JSON.stringify(key);
    if (!this.locks[s]) this.locks[s] = new AsyncLock();
    return this.locks[s].acquire(s, cb);
  },
  encrypt(buffer, password) {
    if (typeof buffer === 'string') buffer = Buffer.from(buffer);
    let crypto = require('crypto');
    let cipher = crypto.createCipher('aes-256-ctr', password);
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
  },
  decrypt(buffer, password) {
    let crypto = require('crypto');
    let decipher = crypto.createDecipher('aes-256-ctr', password);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  },
  async isFile(path) {
    try {
      return (await fs.statAsync(path)).isFile();
    } catch (e) {
      return false;
    }
  },
  async isDir(path) {
    try {
      return (await fs.statAsync(path)).isDirectory();
    } catch (e) {
      return false;
    }
  },
  async saveConfig() {
    let fs = require('fs-extra');
    fs.writeFileAsync(syzoj.configDir, JSON.stringify(syzoj.configInFile, null, 2));
  },
  withTimeoutRetry(func) {
    let attemptCount = 0;
    return new Promise((resolve, reject) => {
      function attempt() {
        if (attemptCount++) console.log(`syzoj.utils.withTimeout(): attemptCount = ${attemptCount}`);
        Promise.method(func)().timeout(5000)
        .then(resolve)
        .catch(Promise.TimeoutError, attempt)
        .catch(reject);
      }
      attempt();
    });
  },
  getCurrentLocation(req, hostOnly) {
    const currentProto = req.get("X-Forwarded-Proto") || req.protocol;
    const host = req.get('host');
    // nginx config:   
    //  proxy_set_header Host $http_host;
    const baseUrl = `${currentProto}://${host}`;
    return hostOnly ? baseUrl : baseUrl + req.originalUrl;
  }
};
