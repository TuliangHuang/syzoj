const objectPath = require('object-path');
let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let Article = syzoj.model('article');
let Contest = syzoj.model('contest');
let User = syzoj.model('user');
const RegistrationRequest = syzoj.model('registration_request');
let UserPrivilege = syzoj.model('user_privilege');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
let ContestPlayer = syzoj.model('contest_player');
const calcRating = require('../libs/rating');
const { countCodeTokens } = syzoj.lib('tokenizer');

app.get('/admin/info', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let allSubmissionsCount = await JudgeState.count();
    let todaySubmissionsCount = await JudgeState.count({
      submit_time: TypeORM.MoreThanOrEqual(syzoj.utils.getCurrentDate(true))
    });
    let problemsCount = await Problem.count();
    let articlesCount = await Article.count();
    let contestsCount = await Contest.count();
    let usersCount = await User.count();

    res.render('admin_info', {
      allSubmissionsCount: allSubmissionsCount,
      todaySubmissionsCount: todaySubmissionsCount,
      problemsCount: problemsCount,
      articlesCount: articlesCount,
      contestsCount: contestsCount,
      usersCount: usersCount
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

let configItems = {
  'title': { name: '站点标题', type: String },
  'google_analytics': { name: 'Google Analytics', type: String },
  '默认参数': null,
  'default.problem.time_limit': { name: '时间限制（单位：ms）', type: Number },
  'default.problem.memory_limit': { name: '空间限制（单位：MiB）', type: Number },
  '限制': null,
  'limit.time_limit': { name: '最大时间限制（单位：ms）', type: Number },
  'limit.memory_limit': { name: '最大空间限制（单位：MiB）', type: Number },
  'limit.data_size': { name: '所有数据包大小（单位：byte）', type: Number },
  'limit.testdata': { name: '测试数据大小（单位：byte）', type: Number },
  'limit.submit_code': { name: '代码长度（单位：byte）', type: Number },
  'limit.submit_answer': { name: '提交答案题目答案大小（单位：byte）', type: Number },
  'limit.custom_test_input': { name: '自定义测试输入文件大小（单位：byte）', type: Number },
  'limit.testdata_filecount': { name: '测试数据文件数量（单位：byte）', type: Number },
  '每页显示数量': null,
  'page.problem': { name: '题库', type: Number },
  'page.judge_state': { name: '提交记录', type: Number },
  'page.problem_statistics': { name: '题目统计', type: Number },
  'page.ranklist': { name: '排行榜', type: Number },
  'page.discussion': { name: '讨论', type: Number },
  'page.article_comment': { name: '评论', type: Number },
  'page.contest': { name: '比赛', type: Number }
};

app.get('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      configItems[i].val = objectPath.get(syzoj.config, i);
    }

    res.render('admin_config', {
      items: configItems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      if (req.body[i]) {
        let val;
        if (configItems[i].type === Boolean) {
          val = req.body[i] === 'on';
        } else if (configItems[i].type === Number) {
          val = Number(req.body[i]);
        } else {
          val = req.body[i];
        }

        const oldVal = objectPath.get(syzoj.config, i);
        if (oldVal !== val)
          objectPath.set(syzoj.configInFile, i, val);
      }
    }

    syzoj.reloadConfig();
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'config']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let a = await UserPrivilege.find();
    let users = {};
    for (let p of a) {
      if (!users[p.user_id]) {
        users[p.user_id] = {
          user: await User.findById(p.user_id),
          privileges: []
        };
      }

      users[p.user_id].privileges.push(p.privilege);
    }

    res.render('admin_privilege', {
      users: Object.values(users)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let data = JSON.parse(req.body.data);
    for (let id in data) {
      let user = await User.findById(id);
      if (!user) throw new ErrorMessage(`不存在 ID 为 ${id} 的用户。`);
      await user.setPrivileges(data[id]);
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'privilege']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rating', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contests = await Contest.find({
      order: {
        start_time: 'DESC'
      }
    });
    const calcs = await RatingCalculation.find({
      order: {
        id: 'DESC'
      }
    });
    for (const calc of calcs) await calc.loadRelationships();

    res.render('admin_rating', {
      contests: contests,
      calcs: calcs
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/rating/add', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contest = await Contest.findById(req.body.contest);
    if (!contest) throw new ErrorMessage('无此比赛');

    await contest.loadRelationships();
    const newcalc = await RatingCalculation.create({ contest_id: contest.id });
    await newcalc.save();

    if (!contest.ranklist || !contest.ranklist.players || contest.ranklist.players.length <= 1) {
      throw new ErrorMessage("比赛人数太少。");
    }

    const players = [];
    for (let i = 0; i < contest.ranklist.players.length; i++) {
      const player = contest.ranklist.players[i];
      const user = await User.findById(player.user_id);
      players.push({
        user: user,
        rank: i + 1,
        currentRating: user.rating
      });
    }
    const newRating = calcRating(players);
    for (let i = 0; i < newRating.length; i++) {
      const user = newRating[i].user;
      user.rating = newRating[i].currentRating;
      await user.save();
      const newHistory = await RatingHistory.create({
        rating_calculation_id: newcalc.id,
        user_id: user.id,
        rating_after: newRating[i].currentRating,
        rank: newRating[i].rank
      });
      await newHistory.save();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/admin/rating/delete', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const calcList = await RatingCalculation.find({
      where: {
        id: TypeORM.MoreThanOrEqual(req.body.calc_id)
      },
      order: {
        id: 'DESC'
      }
    });
    if (calcList.length === 0) throw new ErrorMessage('ID 不正确');

    for (let i = 0; i < calcList.length; i++) {
      await calcList[i].delete();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_other');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_rejudge', {
      form: {},
      count: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.type === 'reset_count') {
      const problems = await Problem.find();
      for (const p of problems) {
        await p.resetSubmissionCount();
      }
    } else if (req.body.type === 'reset_discussion') {
      const articles = await Article.find();
      for (const a of articles) {
        await a.resetReplyCountAndTime();
      }
    } else if (req.body.type === 'reset_code_length') {
      // Legacy: recompute by bytes
      const submissions = await JudgeState.find();
      for (const s of submissions) {
        if (s.language && s.language.length) {
          s.code_length = Buffer.from(s.code || '').length;
          await s.save();
        }
      }
    } else if (req.body.type === 'reset_token_count') {
      const submissions = await JudgeState.find();
      const affectedProblems = new Map();
      for (const s of submissions) {
        if (s.language && s.language.length) {
          s.token_count = countCodeTokens(s.code || '', s.language);
          await s.save();
          if (!affectedProblems.has(s.problem_id)) affectedProblems.set(s.problem_id, new Set());
          if (s.status === 'Accepted') affectedProblems.get(s.problem_id).add(s.user_id);
        }
      }
      // Recompute statistics for affected problems/users since shortest/longest changed
      for (const [problemId, userSet] of affectedProblems.entries()) {
        const problem = await Problem.findById(problemId);
        if (!problem) continue;
        for (const userId of userSet) {
          try { await problem.updateStatistics(userId); } catch (e) { syzoj.log(e); }
        }
      }
    } else if (req.body.type === 'import_luogu') {
      if (!syzoj.config.luogu_openapi_token)
        throw new ErrorMessage("请在配置文件中填写洛谷 OpenAPI Token：\"luogu_openapi_token\"");
      const { fetchProblems } = require("@menci/luogu-openapi");
      const luoguProblems = await fetchProblems();
      const problemMap = {};
      const problems = await Problem.find({ where: { type: "vjudge:luogu" } });
      for (const problem of problems) problemMap[problem.vjudge_config] = problem;
      for (const p of luoguProblems) {
        const problem = p.pid in problemMap ? problemMap[p.pid] : Problem.create({ type: 'vjudge:luogu' });
        problem.title = p.title;
        // WTF '[Ynoi2078] 《How to represent part-whole hierarchies in a neural network》阅读报告（更新中...）'
        if (problem.title.length > 80) problem.title = problem.title.slice(0, 80);
        problem.description = [p.background, p.description, p.translation].filter(x => x && x.trim()).join("\n\n---\n\n");
        problem.input_format = p.inputFormat;
        problem.output_format = p.outputFormat;
        problem.example = p.samples.map((s, i) => `### 样例输入 ${i + 1}\n\n\`\`\`plain\n${s[0]}\n\`\`\`\n\n### 样例输出 ${i + 1}\n\n\`\`\`plain\n${s[1]}\n\`\`\`\n`).join("\n");
        problem.limit_and_hint = p.hint;
        problem.time_limit = Number.isSafeInteger(p.timeLimit) ? p.timeLimit : 0;
        problem.memory_limit = Number.isSafeInteger(p.memoryLimit) ? Math.round(p.memoryLimit / 1024) : 0;
        problem.is_public = true;
        problem.publicize_time = new Date;
        problem.vjudge_config = p.pid;
        problem.is_anonymous = true;
        problem.user_id = res.locals.user.id;
        problem.publicizer_id = res.locals.user.id;
        await problem.save();
      }
    } else {
      throw new ErrorMessage("操作类型不正确");
    }

    res.render('admin_other', {
      success: true
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});
app.post('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let query = JudgeState.createQueryBuilder();

    let user = await User.fromName(req.body.submitter || '');
    if (user) {
      query.andWhere('user_id = :user_id', { user_id: user.id });
    } else if (req.body.submitter) {
      query.andWhere('user_id = :user_id', { user_id: 0 });
    }

    let minID = parseInt(req.body.min_id);
    if (!isNaN(minID)) query.andWhere('id >= :minID', { minID })
    let maxID = parseInt(req.body.max_id);
    if (!isNaN(maxID)) query.andWhere('id <= :maxID', { maxID })

    let minScore = parseInt(req.body.min_score);
    if (!isNaN(minScore)) query.andWhere('score >= :minScore', { minScore });
    let maxScore = parseInt(req.body.max_score);
    if (!isNaN(maxScore)) query.andWhere('score <= :maxScore', { maxScore });

    let minTime = syzoj.utils.parseDate(req.body.min_time);
    if (!isNaN(minTime)) query.andWhere('submit_time >= :minTime', { minTime: parseInt(minTime) });
    let maxTime = syzoj.utils.parseDate(req.body.max_time);
    if (!isNaN(maxTime)) query.andWhere('submit_time <= :maxTime', { maxTime: parseInt(maxTime) });

    if (req.body.language) {
      if (req.body.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
      } else if (req.body.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');;
      } else {
        query.andWhere('language = :language', { language: req.body.language });
      }
    }

    if (req.body.status) {
      query.andWhere('status = :status', { status: req.body.status });
    }

    if (req.body.problem_id) {
      query.andWhere('problem_id = :problem_id', { problem_id: parseInt(req.body.problem_id) || 0 })
    }

    let count = await JudgeState.countQuery(query);
    if (req.body.type === 'rejudge') {
      let submissions = await JudgeState.queryAll(query);
      for (let submission of submissions) {
        await submission.rejudge();
      }
    }

    res.render('admin_rejudge', {
      form: req.body,
      count: count
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_links', {
      links: syzoj.config.links || []
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (JSON.stringify(syzoj.config.links) !== req.body.data) {
      syzoj.configInFile.links = JSON.parse(req.body.data);
      syzoj.reloadConfig();
      await syzoj.utils.saveConfig();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'links']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_raw', {
      data: JSON.stringify(syzoj.configInFile, null, 2)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.configInFile = JSON.parse(req.body.data);
    syzoj.reloadConfig();
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'raw']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/restart', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.restart();

    res.render('admin_restart');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/serviceID', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.send({
        serviceID: syzoj.serviceID
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

// Registration review list
app.get('/admin/registrations', async (req, res) => {
  try {
    if (!res.locals.user || !(res.locals.user.is_admin || await res.locals.user.hasPrivilege('manage_user'))) throw new ErrorMessage('您没有权限进行此操作。');
    const status = req.query.status || 'pending';
    const requests = await RegistrationRequest.find({
      where: { status },
      order: { id: 'DESC' }
    });
    res.render('admin_registrations', {
      requests: requests,
      curStatus: status
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Approve registration
app.post('/admin/registrations/:id/approve', async (req, res) => {
  try {
    if (!res.locals.user || !(res.locals.user.is_admin || await res.locals.user.hasPrivilege('manage_user'))) throw new ErrorMessage('您没有权限进行此操作。');
    const id = parseInt(req.params.id);
    const rr = await RegistrationRequest.findById(id);
    if (!rr) throw new ErrorMessage('找不到该注册请求。');
    if (rr.status !== 'pending') throw new ErrorMessage('该请求已处理。');

    // Re-validate uniqueness
    if (await User.fromName(rr.username)) throw new ErrorMessage('用户名已被占用。');
    if (rr.email) {
      const existEmail = await User.findOne({ where: { email: rr.email } });
      if (existEmail) throw new ErrorMessage('邮件地址已被占用。');
    }

    const user = await User.create({
      username: rr.username,
      password: rr.password,
      email: rr.email || null,
      nickname: rr.nickname || null,
      is_show: syzoj.config.default.user.show,
      rating: syzoj.config.default.user.rating,
      register_time: parseInt((new Date()).getTime() / 1000)
    });
    await user.save();

    rr.status = 'approved';
    rr.reviewer_id = res.locals.user.id;
    rr.decided_time = parseInt((new Date()).getTime() / 1000);
    rr.review_reason = (req.body.reason || '').toString();
    await rr.save();

    res.redirect(syzoj.utils.makeUrl(['admin', 'registrations'], { status: 'pending' }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Reject registration
app.post('/admin/registrations/:id/reject', async (req, res) => {
  try {
    if (!res.locals.user || !(res.locals.user.is_admin || await res.locals.user.hasPrivilege('manage_user'))) throw new ErrorMessage('您没有权限进行此操作。');
    const id = parseInt(req.params.id);
    const rr = await RegistrationRequest.findById(id);
    if (!rr) throw new ErrorMessage('找不到该注册请求。');
    if (rr.status !== 'pending') throw new ErrorMessage('该请求已处理。');

    rr.status = 'rejected';
    rr.reviewer_id = res.locals.user.id;
    rr.decided_time = parseInt((new Date()).getTime() / 1000);
    rr.review_reason = (req.body.reason || '').toString();
    await rr.save();

    res.redirect(syzoj.utils.makeUrl(['admin', 'registrations'], { status: 'pending' }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});
