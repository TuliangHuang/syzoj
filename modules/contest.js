let Contest = syzoj.model('contest');
let ContestRanklist = syzoj.model('contest_ranklist');
let ContestPlayer = syzoj.model('contest_player');
let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let User = syzoj.model('user');

const jwt = require('jsonwebtoken');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

app.get('/contests', async (req, res) => {
  try {
    let where;
    if (res.locals.user && res.locals.user.is_admin) where = {}
    else where = { is_public: true };

    let paginate = syzoj.utils.paginate(await Contest.countForPagination(where), req.query.page, syzoj.config.page.contest);
    let contests = await Contest.queryPage(paginate, where, {
      start_time: 'DESC'
    });

    await contests.forEachAsync(async x => x.subtitle = await syzoj.utils.markdown(x.subtitle));

    res.render('contests', {
      contests: contests,
      paginate: paginate
    })
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/edit', async (req, res) => {
  try {

    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    if (!contest) {
      // if contest does not exist, only system administrators can create one
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      contest = await Contest.create();
      contest.id = 0;
    } else {
      // if contest exists, both system administrators and contest administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');

      await contest.loadRelationships();
    }

    let problems = [], admins = [];
    if (contest.problems) problems = await contest.problems.split('|').mapAsync(async id => await Problem.findById(id));
    if (contest.admins) admins = await contest.admins.split('|').mapAsync(async id => await User.findById(id));

    res.render('contest_edit', {
      contest: contest,
      problems: problems,
      admins: admins
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/edit', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    let ranklist = null;
    if (!contest) {
      // if contest does not exist, only system administrators can create one
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      contest = await Contest.create();

      contest.holder_id = res.locals.user.id;

      ranklist = await ContestRanklist.create();
    } else {
      // if contest exists, both system administrators and contest administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');
      
      await contest.loadRelationships();
      ranklist = contest.ranklist;
    }

    try {
      ranklist.ranking_params = JSON.parse(req.body.ranking_params);
    } catch (e) {
      ranklist.ranking_params = {};
    }
    await ranklist.save();
    contest.ranklist_id = ranklist.id;

    if (!['noi', 'ioi', 'acm', 'open'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
    await contest.setType(req.body.type);

    if (!req.body.title.trim()) throw new ErrorMessage('比赛名不能为空。');
    contest.title = req.body.title;
    contest.subtitle = req.body.subtitle;
    if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    contest.problems = req.body.problems.join('|');
    contest.admins = req.body.admins.join('|');
    contest.information = req.body.information;
    contest.start_time = syzoj.utils.parseDate(req.body.start_time);
    contest.end_time = syzoj.utils.parseDate(req.body.end_time);
    contest.is_public = req.body.is_public === 'on';
    contest.hide_statistics = req.body.hide_statistics === 'on';
    // show_ranklist: open 强制 false；其他类型按开关保存
    if (req.body.type === 'open') {
      contest.show_ranklist = false;
    } else {
      contest.show_ranklist = req.body.show_ranklist === 'on';
    }

    await contest.save();

    res.redirect(syzoj.utils.makeUrl(['contest', contest.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/reset', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    
    if (!contest) {
      return res.render('error', { err: new Error('比赛不存在') });
    }

    // 检查权限：只有系统管理员和比赛管理员可以重新统计
    if (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString()))) {
      return res.render('error', { err: new Error('您没有权限进行此操作') });
    }

    // 调用 reset 函数
    await contest.reset();
    
    // 直接跳转到比赛页面
    res.redirect(`/contest/${contest.id}`);
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.post('/contest/:id/reset', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    
    if (!contest) {
      return res.json({ success: false, message: '比赛不存在' });
    }

    // 检查权限：只有系统管理员和比赛管理员可以重新统计
    if (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString()))) {
      return res.json({ success: false, message: '您没有权限进行此操作' });
    }

    // 调用 reset 函数
    await contest.reset();
    
    res.json({ success: true, message: '重新统计完成' });
  } catch (e) {
    syzoj.log(e);
    res.json({ success: false, message: e.message || '重新统计失败' });
  }
});

app.get('/contest/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;
    let contest_id = parseInt(req.params.id);

    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');

    const isSupervisior = await contest.isSupervisior(curUser);

    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();
    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    let player = null;

    if (res.locals.user) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        if (contest.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_id = await player.getJudgeId(problem.problem.id);
            if (judge_id > 0) {
              let judge_state = await JudgeState.findById(judge_id);
              if (judge_state) {
                problem.status = judge_state.status;
                if (!contest.ended && !await problem.problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
                  problem.status = 'Submitted';
                }
              }
            }
            problem.judge_id = judge_id;
          }
        } else if (contest.type === 'ioi') {
          if (player.score_details[problem.problem.id]) {
            let judge_id = await player.getJudgeId(problem.problem.id);
            if (judge_id > 0) {
              let judge_state = await JudgeState.findById(judge_id);
              if (judge_state) {
                problem.status = judge_state.status;
                await contest.loadRelationships();
                let multiplier = contest.ranklist.ranking_params[problem.problem.id] || 1.0;
                problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
              }
            }
            problem.judge_id = judge_id;
          }
        } else if (contest.type === 'acm') {
          if (player.score_details[problem.problem.id]) {
            problem.status = {
              accepted: player.score_details[problem.problem.id].accepted,
              unacceptedCount: player.score_details[problem.problem.id].unacceptedCount
            };
            problem.judge_id = await player.getJudgeId(problem.problem.id);
          } else {
            problem.status = null;
          }
        }
      }
    }

    let hasStatistics = false;
    if ((!contest.hide_statistics) || (contest.ended) || (isSupervisior)) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = contest.ranklist.players || [];

      if (hasStatistics) {
        await problems.forEachAsync(async (item) => {
          item.judge_state = await item.problem.getJudgeState(res.locals.user, true);
          item.tags = await item.problem.getTags();
        });
      }

      for (let problem of problems) {
        problem.statistics = { attempt: 0, accepted: 0 };

        if (contest.type === 'ioi' || contest.type === 'noi') {
          problem.statistics.partially = 0;
        }

        for (let rankedPlayer of players) {
          let player = await ContestPlayer.findById(rankedPlayer.player_id);
          if (player && player.score_details && player.score_details[problem.problem.id]) {
            problem.statistics.attempt++;
            if ((contest.type === 'acm' && player.score_details[problem.problem.id].accepted) || ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score === 100)) {
              problem.statistics.accepted++;
            }

            if ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score > 0) {
              problem.statistics.partially++;
            }
          }
        }
      }
    }

    res.render('contest', {
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      isSupervisior: isSupervisior
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/ranklist', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    if (contest.type === 'open') throw new ErrorMessage('OPEN 比赛不提供排行榜。');
    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    // 访问排行榜权限：OPEN 禁止；其余为 seeResult 或 show_ranklist 或比赛结束或负责人
    const seeResult = (contest.type === 'open') || (await contest.isSupervisior(curUser) || contest.isEnded());
    const canSeeByFlag = !!contest.show_ranklist;
    const canSee = (contest.type !== 'open') && (seeResult || canSeeByFlag || contest.isEnded() || await contest.isSupervisior(curUser));
    if (!canSee) throw new ErrorMessage('您没有权限进行此操作。');

    await contest.loadRelationships();

    let players = contest.ranklist.players || [];
    let ranklist = await players.mapAsync(async playerData => {
      let player = await ContestPlayer.findById(playerData.player_id);
      let user = await User.findById(playerData.user_id);
      // 检查 player 和 user 是否存在
      if (!player || !user) {
        return null; // 跳过无效的玩家数据
      }

      // 加载 judge_state 用于显示
      // 检查 player.score_details 是否存在
      if (!player.score_details) {
        throw new Error(`ContestPlayer ${player.id} 的 score_details 为空，数据异常`);
      }
      for (let i in player.score_details) {
        let score_detail = player.score_details[i];
        let judgeId = 0;
        
        // 根据赛制选择对应的评测ID（i 为题目 ID 键）
        judgeId = await player.getJudgeId(parseInt(i));
        
        if (judgeId > 0) {
          score_detail.judge_state = await JudgeState.findById(judgeId);
        }
        
        // 将计算好的 judgeId 存储到 score_detail 中供前端使用
        score_detail.judge_id = judgeId;
        
        // 计算时间字段供前端使用
        if (contest.type === 'ioi') {
          score_detail.submit_time = score_detail.best_time;
          score_detail.score = score_detail.best_score;  // IOI使用最高分
        } else if (contest.type === 'noi') {
          score_detail.submit_time = score_detail.latest_time;
          score_detail.score = score_detail.latest_score;  // NOI使用最新分
        } else if (contest.type === 'acm') {
          score_detail.submit_time = score_detail.accepted_time;
          score_detail.score = score_detail.accepted ? 100 : 0;  // ACM使用通过状态
        }
        
        // 计算 weighted_score 用于显示（临时计算，不保存）
        if (contest.type === 'noi' || contest.type === 'ioi') {
          let multiplier = (contest.ranklist.ranking_params || {})[i] || 1.0;
          let score = contest.type === 'ioi' ? score_detail.best_score : score_detail.latest_score;
          score_detail.weighted_score = score == null ? null : Math.round(score * multiplier);
        }
      }

      return {
        user: user,
        player: {
          ...player,
          score: playerData.score,
          latest: playerData.latest,
          timeSum: playerData.timeSum
        }
      };
    });

    // 过滤掉 null 值（无效的玩家数据）
    ranklist = ranklist.filter(item => item !== null);

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    res.render('contest_ranklist', {
      contest: contest,
      ranklist: ranklist,
      problems: problems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/upsolving', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    if (contest.type !== 'open') {
      if ([contest.allowedSeeingOthers(),
      contest.isEnded(),
      await contest.isSupervisior(curUser)].every(x => !x))
        throw new ErrorMessage('您没有权限进行此操作。');
    }
    await contest.loadRelationships();

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    let ranklist = await contest.ranklist.players.mapAsync(async playerData => {
      let user = await User.findById(playerData.user_id);
      return {
        user: user,
        total: 0,
      };
    });

    // Ensure current user appears in upsolving ranklist
    if (curUser) {
      const exists = ranklist.some(item => item.user && item.user.id === curUser.id);
      if (!exists) {
        ranklist.push({ user: curUser, total: 0 });
      }
    }

    await problems.forEachAsync(async (problem) => {
      const statusMap = new Map();
      await Promise.all(ranklist.map(async (item) => {
        const judge_state = await problem.getJudgeState(item.user, true);
        if (judge_state) statusMap.set(item.user.id, judge_state);
      }));
      problem.playerStatusMap = statusMap;
    });

    for (const item of ranklist) {
      for (const problem of problems) {
        if (problem.playerStatusMap.has(item.user.id)) {
          item.total += await problem.playerStatusMap.get(item.user.id).isAccepted();
        }
      }
    }
    ranklist.sort((a, b) => b.total - a.total);

    res.render('contest_upsolving', {
      contest: contest,
      ranklist: ranklist,
      problems: problems,
      currentUserId: curUser ? curUser.id : null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

function getDisplayConfig(contest) {
  if (contest.type === 'open') {
    return {
      showScore: true,
      showUsage: true,
      showCode: true,
      showResult: true,
      showOthers: true,
      showTestdata: true,
      showDetailResult: true,
      inContest: true,
      showOptions: false,
      showRejudge: false
    };
  }
  return {
    showScore: contest.allowedSeeingScore(),
    showUsage: false,
    showCode: false,
    showResult: contest.allowedSeeingResult(),
    showOthers: contest.allowedSeeingOthers(),
    showDetailResult: contest.allowedSeeingTestcase(),
    showTestdata: false,
    inContest: true,
    showOptions: false,
    showRejudge: false
  };
}

app.get('/contest/:id/submissions', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    const displayConfig = getDisplayConfig(contest);
    let problems_id = await contest.getProblems();
    const curUser = res.locals.user;

    let user = req.query.submitter && await User.fromName(req.query.submitter);

    let query = JudgeState.createQueryBuilder();

    if (displayConfig.showOthers) {
      if (user) {
        query.andWhere('user_id = :user_id', { user_id: user.id });
      }
    } else {
      if (curUser == null || // Not logined
        (user && user.id !== curUser.id)) { // Not querying himself
        throw new ErrorMessage("您没有权限执行此操作。");
      }
      query.andWhere('user_id = :user_id', { user_id: curUser.id });
    }

    if (displayConfig.showScore) {
      let minScore = parseInt(req.body.min_score);
      if (!isNaN(minScore)) query.andWhere('score >= :minScore', { minScore });
      let maxScore = parseInt(req.body.max_score);
      if (!isNaN(maxScore)) query.andWhere('score <= :maxScore', { maxScore });
    }

    if (req.query.language) {
      if (req.body.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
      } else if (req.body.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');
      } else {
        query.andWhere('language = :language', { language: req.body.language })
      }
    }

    if (displayConfig.showResult) {
      if (req.query.status) {
        query.andWhere('status = :status', { status: req.query.status });
      }
    }

    if (req.query.problem_id) {
      problem_id = problems_id[parseInt(req.query.problem_id) - 1] || 0;
      query.andWhere('problem_id = :problem_id', { problem_id })
    }
    // 限制题目范围为本场比赛题目
    if (Array.isArray(problems_id) && problems_id.length) {
      query.andWhere('problem_id IN (:...pids)', { pids: problems_id });
    } else {
      // 无题目时强制空结果
      query.andWhere('problem_id = :nonePid', { nonePid: -1 });
    }

    if (contest.type === 'open') {
      // OPEN 比赛：视图展示普通提交，且限定为本场参赛选手
      query.andWhere('type = 0');
      await contest.loadRelationships();
      const players = contest.ranklist && contest.ranklist.players ? contest.ranklist.players : [];
      const playerUserIds = await players.mapAsync(async p => (await ContestPlayer.findById(p.player_id))?.user_id).then(arr => arr.filter(Boolean));
      if (playerUserIds.length === 0) {
        query.andWhere('user_id = :none', { none: -1 });
      } else {
        query.andWhere('user_id IN (:...uids)', { uids: playerUserIds });
      }
    } else {
      // 非 OPEN 比赛：仅显示比赛内提交
      query.andWhere('type = 1')
           .andWhere('type_info = :contest_id', { contest_id });
    }

    let judge_state, paginate;

    if (syzoj.config.submissions_page_fast_pagination) {
      const queryResult = await JudgeState.queryPageFast(query, syzoj.utils.paginateFast(
        req.query.currPageTop, req.query.currPageBottom, syzoj.config.page.judge_state
      ), -1, parseInt(req.query.page));

      judge_state = queryResult.data;
      paginate = queryResult.meta;
    } else {
      paginate = syzoj.utils.paginate(
        await JudgeState.countQuery(query),
        req.query.page,
        syzoj.config.page.judge_state
      );
      judge_state = await JudgeState.queryPage(paginate, query, { id: "DESC" }, true);
    }

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
      obj.problem_id = problems_id.indexOf(obj.problem_id) + 1;
      obj.problem.title = syzoj.utils.removeTitleTag(obj.problem.title);
    });

    const pushType = displayConfig.showResult ? 'rough' : 'compile';
    res.render('submissions', {
      vjudge: require("../libs/vjudge"),
      contest: contest,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (getRoughResult(x, displayConfig) == null && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: pushType,
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig),
        running: false,
      })),
      paginate: paginate,
      form: req.query,
      displayConfig: displayConfig,
      pushType: pushType,
      fast_pagination: syzoj.config.submissions_page_fast_pagination
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});


app.get('/contest/submission/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const judge = await JudgeState.findById(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");

    const curUser = res.locals.user;
    if ((!curUser) || judge.user_id !== curUser.id) throw new ErrorMessage("您没有权限执行此操作。");

    if (judge.type !== 1) {
      return res.redirect(syzoj.utils.makeUrl(['submission', id]));
    }

    const contest = await Contest.findById(judge.type_info);
    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();

    const displayConfig = getDisplayConfig(contest);
    displayConfig.showCode = true;
    if (contest.type === 'open') {
      displayConfig.showOptions = true;
    }

    await judge.loadRelationships();
    const problems_id = await contest.getProblems();
    judge.problem_id = problems_id.indexOf(judge.problem_id) + 1;
    judge.problem.title = syzoj.utils.removeTitleTag(judge.problem.title);

    if (judge.problem.type !== 'submit-answer') {
      judge.codeLength = Buffer.from(judge.code).length;
      judge.code = await syzoj.utils.highlight(judge.code, (judge.problem.getVJudgeLanguages() || syzoj.languages)[judge.language].highlight);
    }

    res.render('submission', {
      info: getSubmissionInfo(judge, displayConfig),
      roughResult: getRoughResult(judge, displayConfig),
      code: (displayConfig.showCode && judge.problem.type !== 'submit-answer') ? judge.code.toString("utf8") : '',
      formattedCode: judge.formattedCode ? judge.formattedCode.toString("utf8") : null,
      preferFormattedCode: res.locals.user ? res.locals.user.prefer_formatted_code : false,
      detailResult: processOverallResult(judge.result, displayConfig),
      socketToken: (displayConfig.showDetailResult && judge.pending && judge.task_id != null) ? jwt.sign({
        taskId: judge.task_id,
        displayConfig: displayConfig,
        type: 'detail'
      }, syzoj.config.session_secret) : null,
      displayConfig: displayConfig,
      contest: contest,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/problem/:pid', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    const curUser = res.locals.user;

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);
    await problem.loadRelationships();

    // Expose permissions for editing/managing the problem while viewed in contest
    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();
    if (!await contest.isSupervisior(curUser) && !(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id]));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(res.locals.user, false);
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    await problem.loadRelationships();

    res.render('problem', {
      pid: pid,
      contest: contest,
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      languages: problem.getVJudgeLanguages()
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/:pid/download/additional_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let contest = await Contest.findById(id);
    if (!contest) throw new ErrorMessage('无此比赛。');

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);

    contest.ended = contest.isEnded();
    if (!(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id, 'download', 'additional_file']));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    res.download(problem.additional_file.getPath(), `additional_file_${id}_${pid}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});
