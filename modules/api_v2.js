const jwt = require('jsonwebtoken');
const url = require('url');

app.get('/api/v2/search/users/:keyword*?', async (req, res) => {
  try {
    let User = syzoj.model('user');

    let keyword = req.params.keyword || '';
    let conditions = [];
    const uid = parseInt(keyword) || 0;

    if (uid != null && !isNaN(uid)) {
      conditions.push({ id: uid });
    }
    if (keyword != null && String(keyword).length >= 2) {
      conditions.push({ username: TypeORM.Like(`%${req.params.keyword}%`) });
    }
    if (conditions.length === 0) {
      res.send({ success: true, results: [] });
    } else {
      let users = await User.find({
        where: conditions,
        order: {
          username: 'ASC'
        }
      });

      let result = [];

      result = users.map(x => ({ name: `${x.username}`, value: x.id, url: syzoj.utils.makeUrl(['user', x.id]) }));
      res.send({ success: true, results: result });
    }
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false });
  }
});

app.get('/api/v2/search/problems/:keyword*?', async (req, res) => {
  try {
    let Problem = syzoj.model('problem');

    let keyword = req.params.keyword || '';
    let problems = await Problem.find({
      where: {
        title: TypeORM.Like(`%${req.params.keyword}%`)
      },
      order: {
        id: 'ASC'
      }
    });

    let result = [];

    let id = parseInt(keyword);
    if (id) {
      let problemById = await Problem.findById(parseInt(keyword));
      if (problemById && await problemById.isAllowedUseBy(res.locals.user)) {
        result.push(problemById);
      }
    }
    await problems.forEachAsync(async problem => {
      if (await problem.isAllowedUseBy(res.locals.user) && result.length < syzoj.config.page.edit_contest_problem_list && problem.id !== id) {
        result.push(problem);
      }
    });

    result = result.map(x => ({ name: `#${x.id}. ${x.title}`, value: x.id, url: syzoj.utils.makeUrl(['problem', x.id]) }));
    res.send({ success: true, results: result });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false });
  }
});

app.get('/api/v2/search/tags/:keyword*?', async (req, res) => {
  try {
    let Problem = syzoj.model('problem');
    let ProblemTag = syzoj.model('problem_tag');

    let keyword = req.params.keyword || '';
    let tags = await ProblemTag.find({
      where: {
        name: TypeORM.Like(`%${req.params.keyword}%`)
      },
      order: {
        name: 'ASC'
      }
    });
    tags.sort((a, b) => {
      const pa = a.name.startsWith(keyword),
        pb = b.name.startsWith(keyword);
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      const ia = a.name.indexOf(keyword),
        ib = b.name.indexOf(keyword);
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name, 'zh');
    });
    let result = tags.slice(0, syzoj.config.page.edit_problem_tag_list);

    result = result.map(x => ({ name: x.name, value: x.id }));
    res.send({ success: true, results: result });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false });
  }
});

// search question tags
app.get('/api/v2/search/question-tags/:keyword*?', async (req, res) => {
  try {
    let QuestionTag = syzoj.model('question_tag');

    let keyword = req.params.keyword || '';
    let tags = await QuestionTag.find({
      where: {
        name: TypeORM.Like(`%${keyword}%`)
      },
      order: {
        name: 'ASC'
      }
    });

    tags.sort((a, b) => {
      const pa = a.name.startsWith(keyword),
        pb = b.name.startsWith(keyword);
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      const ia = a.name.indexOf(keyword),
        ib = b.name.indexOf(keyword);
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name, 'zh');
    });

    let result = tags.slice(0, syzoj.config.page.edit_problem_tag_list)
                     .map(x => ({ name: x.name, value: String(x.id) }));
    res.send({ success: true, results: result });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, results: [] });
  }
});

app.apiRouter.post('/api/v2/markdown', async (req, res) => {
  try {
    let s = await syzoj.utils.markdown(req.body.s.toString(), null, req.body.noReplaceUI === 'true');
    res.send(s);
  } catch (e) {
    syzoj.log(e);
    res.send(e);
  }
});

// Render question-like markdown into description and structured items
app.apiRouter.post('/api/v2/question/render', async (req, res) => {
  try {
    const markdown = String(req.body.s || '');
    const rendered = await syzoj.utils.renderQuestion(markdown, req.body.noReplaceUI === 'true');
    res.send({ success: true, description: rendered.description, items: rendered.items || [], numberingMode: rendered.numberingMode });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, error: e.toString() });
  }
});

function verifyJWT(token) {
  try {
    jwt.verify(token, syzoj.config.session_secret);
    return true;
  } catch (e) {
    return false;
  }
}

app.apiRouter.get('/api/v2/download/:token', async (req, res) => {
  try {
    const token = req.params.token, data = jwt.decode(token);
    if (!data) throw new ErrorMessage("无效的令牌。");
    if (url.parse(syzoj.utils.getCurrentLocation(req, true)).href !== url.parse(syzoj.config.site_for_download).href) {
      throw new ErrorMessage("无效的下载地址。");
    }

    if (verifyJWT(token)) {
      res.download(data.filename, data.sendName);
    } else {
      res.redirect(data.originUrl);
    }
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
})
