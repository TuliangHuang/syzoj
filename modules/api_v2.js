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

    let result = tags.slice(0, syzoj.config.page.edit_problem_tag_list)
                     .map(x => ({ name: x.name, value: String(x.id) }));
    res.send({ success: true, results: result });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, results: [] });
  }
});

// Create question tag (v2)
app.apiRouter.post('/api/v2/question-tags', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem_tag')) {
      return res.status(403).json({ success: false, error: '权限不足。' });
    }

    const QuestionTag = syzoj.model('question_tag');

    let name = String(req.body.name || '').trim();
    let color = String(req.body.color || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: '标签名称不能为空。' });
    }

    let existing = await QuestionTag.findOne({ where: { name: name } });
    if (existing) {
      return res.json({ success: true, tag: { id: existing.id, name: existing.name, color: existing.color } });
    }

    let tag = await QuestionTag.create();
    tag.name = name;
    tag.color = color || 'black';
    await tag.save();

    return res.json({ success: true, tag: { id: tag.id, name: tag.name, color: tag.color } });
  } catch (e) {
    syzoj.log(e);
    return res.status(500).json({ success: false, error: '服务器错误。' });
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
    // If parent_id is provided, prepend parent description like the question page
    let combined = markdown;
    const parentId = parseInt(req.body.parent_id);
    if (parentId && parentId > 0) {
      try {
        const Question = syzoj.model('question');
        const parent = await Question.findById(parentId);
        if (parent && parent.description) {
          combined = [parent.description, markdown].filter(Boolean).join('\n\n');
        }
      } catch (e) {}
    }
    const rendered = await syzoj.utils.renderQuestion(combined, req.body.noReplaceUI === 'true');
    res.send({ success: true, description: rendered.description, items: rendered.items || [], numberingMode: rendered.numberingMode, showAllPoints: rendered.showAllPoints });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, error: e.toString() });
  }
});

// GPA Courses: resolve by alias name
app.get('/api/v2/nebs-courses/resolve', async (req, res) => {
  try {
    const NebsCourseGpa = syzoj.model('nebs_course_gpa');
    const name = String(req.query.name || '').trim();
    if (!name) return res.json({ success: true, found: false });
    let alias = await NebsCourseGpa.findOne({ where: { name } });
    if (!alias) return res.json({ success: true, found: false });
    let target = alias;
    if (alias.official_id) {
      const official = await NebsCourseGpa.findById(alias.official_id);
      if (official) target = official;
    }
    return res.json({ success: true, found: true, course: { id: target.id, name: target.name, credit: target.credit || 0.5, full_gpa: target.full_gpa || 4.0 } });
  } catch (e) {
    syzoj.log(e);
    res.json({ success: false });
  }
});

// GPA Courses: search official courses by keyword (only official entries: official_id is null)
app.get('/api/v2/nebs-courses/search', async (req, res) => {
  try {
    const NebsCourseGpa = syzoj.model('nebs_course_gpa');
    const keyword = String(req.query.keyword || '').trim();
    if (!keyword) return res.json({ success: true, results: [] });
    const list = await NebsCourseGpa.find({
      where: {
        name: TypeORM.Like(`%${keyword}%`),
        official_id: null
      },
      order: { name: 'ASC' }
    });
    const results = list.map(x => ({ id: x.id, name: x.name, credit: x.credit || 0.5, full_gpa: x.full_gpa || 4.0 }));
    res.json({ success: true, results });
  } catch (e) {
    syzoj.log(e);
    res.json({ success: false, results: [] });
  }
});

// GPA Courses: create or link alias
app.post('/api/v2/nebs-courses', async (req, res) => {
  try {
    // permission: only admin or username === 'ping'
    if (!res.locals.user || !(res.locals.user.is_admin || (String(res.locals.user.username || '').toLowerCase() === 'ping'))) {
      return res.status(403).json({ success: false, error: '权限不足。' });
    }

    const NebsCourseGpa = syzoj.model('nebs_course_gpa');
    const aliasName = String(req.body.alias_name || '').trim();
    const officialId = req.body.official_id ? parseInt(req.body.official_id) : null;
    let officialName = req.body.official_name ? String(req.body.official_name).trim() : '';
    const credit = req.body.credit != null ? Number(req.body.credit) : null;
    const full = req.body.full_gpa != null ? Number(req.body.full_gpa) : null;

    if (!aliasName) return res.status(400).json({ success: false, error: 'alias 不能为空' });

    const normalize = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (officialName && normalize(officialName) === normalize(aliasName)) {
      officialName = '';
    }

    let targetOfficial = null;
    if (officialId) {
      targetOfficial = await NebsCourseGpa.findById(officialId);
      if (!targetOfficial || targetOfficial.official_id) return res.status(400).json({ success: false, error: '无效的 official_id' });
    } else {
      // create/find official by name
      const name = officialName || aliasName;
      let existed = await NebsCourseGpa.findOne({ where: { name } });
      if (existed) {
        if (existed.official_id) {
          // if points to another, follow to official
          const off = await NebsCourseGpa.findById(existed.official_id);
          targetOfficial = off || existed;
        } else {
          targetOfficial = existed;
        }
      } else {
        if (credit == null || full == null) return res.status(400).json({ success: false, error: '缺少学分或满绩' });
        let created = NebsCourseGpa.create();
        created.name = name;
        created.official_id = null;
        created.credit = credit;
        created.full_gpa = full;
        await created.save();
        targetOfficial = created;
      }
    }

    // ensure alias exists and points to official
    let alias = await NebsCourseGpa.findOne({ where: { name: aliasName } });
    if (!alias) {
      alias = NebsCourseGpa.create();
      alias.name = aliasName;
    }
    if (targetOfficial && alias.id === targetOfficial.id) {
      // alias is same as official; make sure it's official (no redirect)
      alias.official_id = null;
      if (credit != null) alias.credit = credit;
      if (full != null) alias.full_gpa = full;
    } else {
      alias.official_id = targetOfficial ? targetOfficial.id : null;
      if (!alias.official_id) {
        if (credit != null) alias.credit = credit;
        if (full != null) alias.full_gpa = full;
      }
    }
    await alias.save();

    const ret = targetOfficial || alias;
    return res.json({ success: true, course: { id: ret.id, name: ret.name, credit: ret.credit || 0.5, full_gpa: ret.full_gpa || 4.0 } });
  } catch (e) {
    syzoj.log(e);
    res.status(500).json({ success: false });
  }
});

// Render question items partial with provided data (server-side EJS)
app.apiRouter.post('/api/v2/question/items/render', async (req, res) => {
  try {
    const items = (() => {
      const raw = req.body.items;
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw); } catch (e) { return []; }
    })();
    const showAllPoints = String(req.body.showAllPoints) === 'true';
    res.render('question_items', { items, showAllPoints });
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
