let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let FormattedCode = syzoj.model('formatted_code');
let Contest = syzoj.model('contest');
let ProblemTag = syzoj.model('problem_tag');
let ProblemTagMap = syzoj.model('problem_tag_map');
let Article = syzoj.model('article');
let User = syzoj.model('user');

const TypeORM = require('typeorm');

const randomstring = require('randomstring');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');

let Judger = syzoj.lib('judger');
const { tagColorOrder } = require('../constants');
let CodeFormatter = syzoj.lib('code_formatter');
const { countCodeTokens } = syzoj.lib('tokenizer');

function resolveRedirectUrl(candidate, fallback) {
  if (typeof candidate !== 'string') return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  return candidate;
}

async function hydrateProblemsForList(problems, user) {
  if (!problems || problems.length === 0) return;

  const problemIds = problems.map(p => p.id);

  // Compute allowedEdit without N calls
  let canManageProblem = false;
  if (user) {
    canManageProblem = await user.hasPrivilege('manage_problem');
  }
  for (const p of problems) {
    p.allowedEdit = !!(user && (canManageProblem || p.user_id === user.id));
  }

  // Batch load judge states (accepted first, then latest if none)
  const judgeStateMap = new Map();
  if (user && problemIds.length) {
    const accepted = await JudgeState.createQueryBuilder()
      .where('user_id = :uid', { uid: user.id })
      .andWhere('problem_id IN (:...ids)', { ids: problemIds })
      .andWhere('status = :st', { st: 'Accepted' })
      .orderBy('submit_time', 'DESC')
      .getMany();
    for (const st of accepted) {
      if (!judgeStateMap.has(st.problem_id)) judgeStateMap.set(st.problem_id, st);
    }
    const missing = problemIds.filter(id => !judgeStateMap.has(id));
    if (missing.length) {
      const latest = await JudgeState.createQueryBuilder()
        .where('user_id = :uid', { uid: user.id })
        .andWhere('problem_id IN (:...ids)', { ids: missing })
        .orderBy('submit_time', 'DESC')
        .getMany();
      for (const st of latest) {
        if (!judgeStateMap.has(st.problem_id)) judgeStateMap.set(st.problem_id, st);
      }
    }
  }

  // Batch load tags
  const tagMapByProblem = new Map();
  if (problemIds.length) {
    const maps = await ProblemTagMap.createQueryBuilder()
      .where('problem_id IN (:...ids)', { ids: problemIds })
      .getMany();
    const tagIds = Array.from(new Set(maps.map(m => m.tag_id)));
    const tags = tagIds.length ? await ProblemTag.createQueryBuilder().whereInIds(tagIds).getMany() : [];
    const tagById = new Map(tags.map(t => [t.id, t]));

    // Sorting same as Problem.getTags()
    const sortOrder = tagColorOrder;
    const orderMap = {};
    sortOrder.forEach((color, idx) => { if (!(color in orderMap)) orderMap[color] = idx; });

    for (const m of maps) {
      if (!tagMapByProblem.has(m.problem_id)) tagMapByProblem.set(m.problem_id, []);
      const tag = tagById.get(m.tag_id);
      if (tag) tagMapByProblem.get(m.problem_id).push(tag);
    }

    for (const [pid, arr] of tagMapByProblem) {
      arr.sort((a, b) => {
        if (a.color === b.color) return a.name.localeCompare(b.name, 'zh');
        const ia = orderMap[a.color];
        const ib = orderMap[b.color];
        if (ia !== undefined && ib !== undefined) return ia - ib;
        return a.color < b.color ? -1 : 1;
      });
    }
  }

  for (const p of problems) {
    if (user) p.judge_state = judgeStateMap.get(p.id) || null;
    p.tags = tagMapByProblem.get(p.id) || [];
  }
}

app.get('/problems', async (req, res) => {
  try {
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate', 'publicize_time', 'difficulty'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder();
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
      if (res.locals.user) {
        query.where('is_public = 1')
             .orWhere('user_id = :user_id', { user_id: res.locals.user.id });
      } else {
        query.where('is_public = 1');
      }
    }

    if (sort === 'ac_rate') {
      query.orderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.orderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await hydrateProblemsForList(problems, res.locals.user);

    const allTags = await ProblemTag.find({ order: { name: 'ASC' } });
    res.render('problems', {
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc',
      allTags: allTags,
      tagColorOrder
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problems/search', async (req, res) => {
  try {
    let id = parseInt(req.query.keyword) || 0;
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate', 'difficulty'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder();
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
      if (res.locals.user) {
        query.where(new TypeORM.Brackets(qb => {
             qb.where('is_public = 1')
                 .orWhere('user_id = :user_id', { user_id: res.locals.user.id })
             }))
             .andWhere(new TypeORM.Brackets(qb => {
               qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
                 .orWhere('id = :id', { id: id })
             }));
      } else {
        query.where('is_public = 1')
             .andWhere(new TypeORM.Brackets(qb => {
               qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
                 .orWhere('id = :id', { id: id })
             }));
      }
    } else {
      query.where('title LIKE :title', { title: `%${req.query.keyword}%` })
           .orWhere('id = :id', { id: id })
    }

    query.orderBy('id = ' + id.toString(), 'DESC');
    if (sort === 'ac_rate') {
      query.addOrderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.addOrderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await hydrateProblemsForList(problems, res.locals.user);

    const allTags = await ProblemTag.find({ order: { name: 'ASC' } });
    res.render('problems', {
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc',
      allTags: allTags,
      tagColorOrder
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/batch', async (req, res) => {
  try {
    if (!res.locals.user) {
      throw new ErrorMessage('请登录后继续。', {
        '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl })
      });
    }
    if (!await res.locals.user.hasPrivilege('manage_problem')) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }
    res.render('batch', {});
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/batch', async (req, res) => {
  try {
    if (!res.locals.user) {
      throw new ErrorMessage('请登录后继续。', {
        '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl })
      });
    }
    if (!await res.locals.user.hasPrivilege('manage_problem')) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let { move_ids } = req.body;
    if (move_ids) {
      const parts = move_ids.split(/[\s,]+/).filter(v => v);
      if (parts.length % 2 !== 0) {
        throw new Error(`需提供偶数个编号，当前为 ${parts.length} 个`);
      }
      const nums = parts.map((v, i) => {
        // 先尝试转换为数字
        const num = Number(v);
        // 验证是否为整数
        if (!Number.isInteger(num)) {
          throw new Error(`第 ${Math.floor(i / 2) + 1} 组 "${v}" 不是有效的整数`);
        }
        return num;
      });
      const oldSeen = new Set();
      const newSeen = new Set();
      for (let i = 0; i < nums.length; i += 2) {
        const oldId = nums[i];
        const newId = nums[i + 1];
        if (oldSeen.has(oldId)) {
          throw new Error(`旧编号 ${oldId} 出现重复`);
        }
        if (newSeen.has(newId)) {
          throw new Error(`新编号 ${newId} 出现重复`);
        }
        oldSeen.add(oldId);
        newSeen.add(newId);
      }

      const result = [];
      for (let i = 0; i < nums.length; i += 2) {
        const oldId = nums[i];
        const problem = await Problem.findById(oldId);
        if (!problem) {
          throw new Error(`编号 ${oldId} 未找到对应题目`);
        }
        const newId = nums[i + 1];
        const new_problem = await Problem.findById(newId);
        if (new_problem && !oldSeen.has(newId)) {
          throw new Error(`编号为 ${newId} 的题目已经存在且没有在此次迁移中被迁移到其他编号`);
        }
        const gapId = -oldId;
        const gap = await Problem.findById(gapId);
        if (gap) {
          throw new Error(`临时编号 ${gapId} 上已经存在题目`);
        }
        result.push({ problem, old_id: oldId, new_id: newId });
      }
      for (const { problem, old_id } of result) {
        await problem.changeID(-old_id);
        await problem.save();
      }
      for (const { problem, new_id } of result) {
        await problem.changeID(new_id);
        await problem.save();
      }
    }
    res.redirect(syzoj.utils.makeUrl(['problems']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    if (!await problem.isAllowedUseBy(res.locals.user)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    if (problem.is_public || problem.allowedEdit) {
      await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);
    } else {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let state = await problem.getJudgeState(res.locals.user, false);

    problem.tags = await problem.getTags();
    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    let discussionCount = await Article.count({ problem_id: id });

    // For problemset entry (non-contest view), do not display File IO hints
    // so the page shows standard IO regardless of problem's stored setting.
    problem.file_io = false;

    res.render('problem', {
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      discussionCount: discussionCount,
      languages: problem.getVJudgeLanguages()
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/export', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let obj = {
      title: problem.title,
      description: problem.description,
      input_format: problem.input_format,
      output_format: problem.output_format,
      example: problem.example,
      limit_and_hint: problem.limit_and_hint,
      time_limit: problem.time_limit,
      memory_limit: problem.memory_limit,
      have_additional_file: problem.additional_file_id != null,
      file_io: problem.file_io,
      file_io_input_name: problem.file_io_input_name,
      file_io_output_name: problem.file_io_output_name,
      type: problem.type,
      tags: []
    };

    let tags = await problem.getTags();

    obj.tags = tags.map(tag => tag.name);

    res.send({ success: true, obj: obj });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, error: e });
  }
});

app.get('/problem/:id/raw', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    const s = (v) => (v == null ? '' : String(v).trim()); // safe string
    let markdown = `# ${s(problem.title)}\n\n`;
    markdown += `## 题目描述\n\n${s(problem.description)}\n\n`;
    markdown += `## 输入格式\n\n${s(problem.input_format)}\n\n`;
    markdown += `## 输出格式\n\n${s(problem.output_format)}\n\n`;
    markdown += `## 样例\n\n${s(problem.example)}\n\n`;
    markdown += `## 数据范围与提示\n\n${s(problem.limit_and_hint)}\n`;

    res.set('Content-Type', 'text/markdown; charset=utf-8'); // RFC 7763
    res.send(markdown);
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, error: e });
  }
});

app.get('/problem/:id/edit', async (req, res) => {
  try {
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);

    if (!problem) {
      if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });
      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });
      problem.id = id;
      problem.allowedEdit = true;
      problem.tags = [];
      problem.new = true;
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.tags = await problem.getTags();
    }

    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    const redirectTo = resolveRedirectUrl(req.query.url, '');
    res.render('problem_edit', {
      problem: problem,
      redirectTo
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/edit', async (req, res) => {
  try {
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);
    let isNewProblem = false;
    if (!problem) {
      if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });
      isNewProblem = true;

      if (await res.locals.user.hasPrivilege('manage_problem')) {
        let customID = parseInt(req.body.id);
        if (customID) {
          if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
          problem.id = customID;
        } else if (id) problem.id = id;
      }

      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

      if (await res.locals.user.hasPrivilege('manage_problem')) {
        let customID = parseInt(req.body.id);
        if (customID && customID !== id) {
          if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
          await problem.changeID(customID);
        }
      }
    }

    problem.title = req.body.title;
    problem.source = req.body.source;
    problem.luogu_url = req.body.luogu_url;
    problem.bzoj_id = req.body.bzoj_id ? req.body.bzoj_id : null;
    problem.description = req.body.description;
    problem.input_format = req.body.input_format;
    problem.output_format = req.body.output_format;
    problem.example = req.body.example;
    problem.limit_and_hint = req.body.limit_and_hint;
    problem.is_anonymous = (req.body.is_anonymous === 'on');
    if (req.body.difficulty !== undefined) {
      const diff = parseInt(req.body.difficulty);
      problem.difficulty = Number.isFinite(diff) ? diff : null;
    }

    if (req.body.raw_code) {
      const result = syzoj.utils.parseMarkdown(req.body.raw_code);
      if (result.title) problem.title = result.title;
      problem.description = result.description;
      problem.input_format = result.input_format;
      problem.output_format = result.output_format;
      problem.example = result.example;
      problem.limit_and_hint = result.limit_and_hint;
    }

    if (!problem.title) throw new ErrorMessage('题目名不能为空。');

    // Check if another problem with the same title already exists
    let existingProblem = await Problem.findOne({
      where: {
        title: problem.title
      }
    });
    
    if (existingProblem && existingProblem.id !== problem.id) {
      throw new ErrorMessage('题目名已存在，请使用不同的题目名。');
    }

    // Save the problem first, to have the `id` allocated
    await problem.save();

    if (!req.body.tags) {
      req.body.tags = [];
    } else if (!Array.isArray(req.body.tags)) {
      req.body.tags = [req.body.tags];
    }

    let newTagIDs = await req.body.tags.map(x => parseInt(x)).filterAsync(async x => ProblemTag.findById(x));

    // Auto-add tags based on problem title for new problems
    if (isNewProblem) {
      const autoTagNames = ['AtCoder', 'BZOJ', 'COCI', 'CodeChef', 'Codeforces', 'IOI', 'Luogu', 'POI', 'ROIR', 'USACO'];

      // Extract content within 「」 brackets
      const bracketMatch = problem.title.match(/「([^」]*)」/);
      if (bracketMatch && bracketMatch[1]) {
        const bracketContent = bracketMatch[1];

        // Check each auto tag name
        for (const tagName of autoTagNames) {
          if (bracketContent.includes(tagName)) {
            // Find the tag by name
            const tag = await ProblemTag.findOne({
              where: {
                name: tagName
              }
            });

            // If tag exists and not already in newTagIDs, add it
            if (tag && !newTagIDs.includes(tag.id)) {
              newTagIDs.push(tag.id);
            }
          }
        }
      }
    }

    await problem.setTags(newTagIDs);

    const defaultRedirect = syzoj.utils.makeUrl(['problem', problem.id]);
    const redirectTarget = resolveRedirectUrl(req.body.redirect || req.body.url, defaultRedirect);

    res.redirect(redirectTarget);
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// The 'manage' is not `allow manage`'s 'manage', I just have no better name for it.
app.get('/problem/:id/manage', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    res.render('problem_manage', {
      problem: problem,
      testcases: testcases
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/manage', app.multer.fields([{ name: 'testdata', maxCount: 1 }, { name: 'additional_file', maxCount: 1 }]), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();

    problem.time_limit = req.body.time_limit;
    problem.memory_limit = req.body.memory_limit;
    if (req.body.type === 'traditional') {
      problem.file_io_input_name = req.body.file_io_input_name;
      problem.file_io_output_name = req.body.file_io_output_name;
    }

    if (problem.type === 'submit-answer' && req.body.type !== 'submit-answer' || problem.type !== 'submit-answer' && req.body.type === 'submit-answer') {
      if (await JudgeState.count({ problem_id: id }) !== 0) {
        throw new ErrorMessage('已有提交的题目不允许在提交答案和非提交答案之间更改。');
      }
    }
    problem.type = req.body.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    if (req.files['testdata']) {
      await problem.updateTestdata(req.files['testdata'][0].path, await res.locals.user.hasPrivilege('manage_problem'));
    }

    if (req.files['additional_file']) {
      await problem.updateFile(req.files['additional_file'][0].path, 'additional_file', await res.locals.user.hasPrivilege('manage_problem'));
    }

    await problem.save();

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'manage']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// Set problem public
async function setPublic(req, res, is_public) {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    let allowedManage = await problem.isAllowedManageBy(res.locals.user);
    if (!allowedManage) throw new ErrorMessage('您没有权限进行此操作。');

    problem.is_public = is_public;
    problem.publicizer_id = res.locals.user.id;
    problem.publicize_time = new Date();
    await problem.save();

    JudgeState.query('UPDATE `judge_state` SET `is_public` = ' + is_public + ' WHERE `problem_id` = ' + id);

    res.redirect(syzoj.utils.makeUrl(['problem', id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
}

app.post('/problem/:id/public', async (req, res) => {
  await setPublic(req, res, true);
});

app.post('/problem/:id/dis_public', async (req, res) => {
  await setPublic(req, res, false);
});

app.post('/problem/:id/submit', app.multer.fields([{ name: 'answer', maxCount: 1 }]), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    const curUser = res.locals.user;

    if (!problem) throw new ErrorMessage('无此题目。');
    const vjudgeLanguages = problem.getVJudgeLanguages();
    if (problem.type !== 'submit-answer' && !(vjudgeLanguages ? Object.keys(vjudgeLanguages) : syzoj.config.enabled_languages).includes(req.body.language)) throw new ErrorMessage('不支持该语言。');
    if (!curUser) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': syzoj.utils.makeUrl(['problem', id]) }) });

    // Determine the effective submitter (admin may proxy as another user)
    let submitAsUser = curUser;
    if (curUser && curUser.is_admin && req.body && req.body.proxy_user_id) {
      const proxyId = parseInt(req.body.proxy_user_id);
      if (!isNaN(proxyId)) {
        const target = await User.findById(proxyId);
        if (!target) throw new ErrorMessage('代提交目标用户不存在。');
        submitAsUser = target;
      }
    }

    let judge_state;
    if (problem.type === 'submit-answer') {
      let File = syzoj.model('file'), path;
      if (!req.files['answer']) {
        // Submited by editor
        try {
          path = await File.zipFiles(JSON.parse(req.body.answer_by_editor));
        } catch (e) {
          throw new ErrorMessage('无法解析提交数据。');
        }
      } else {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');
        path = req.files['answer'][0].path;
      }

      let file = await File.upload(path, 'answer');
      let size = await file.getUnzipSize();

      if (size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');

      if (!file.md5) throw new ErrorMessage('上传答案文件失败。');
      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: file.md5,
        code_length: size,
        token_count: null,
        language: null,
        user_id: submitAsUser.id,
        problem_id: id,
        is_public: problem.is_public
      });
    } else {
      let code;
      if (req.files['answer']) {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_code) throw new ErrorMessage('代码文件太大。');
        code = (await fs.readFile(req.files['answer'][0].path)).toString();
      } else {
        if (Buffer.from(req.body.code).length > syzoj.config.limit.submit_code) throw new ErrorMessage('代码太长。');
        code = req.body.code;
      }

      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: code,
        code_length: Buffer.from(code).length,
        token_count: countCodeTokens(code, req.body.language),
        language: req.body.language,
        user_id: submitAsUser.id,
        problem_id: id,
        is_public: problem.is_public
      });
    }

    let contest_id = parseInt(req.query.contest_id);
    let contest;
    if (contest_id) {
      contest = await Contest.findById(contest_id);
      if (!contest) throw new ErrorMessage('无此比赛。');
      const now = syzoj.utils.getCurrentDate();
      // 禁止比赛时间外的任何提交（包括管理员）
      if (now < contest.start_time) throw new ErrorMessage('比赛尚未开始。');
      if (now > contest.end_time) throw new ErrorMessage('比赛已结束。');
      let problems_id = await contest.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');

      if (contest.type === 'open') {
        // OPEN contest 的提交视为普通提交（type=0），不使用 type_info
        judge_state.type = 0;
        judge_state.type_info = null;
      } else {
        judge_state.type = 1;
        judge_state.type_info = contest_id;
      }

      await judge_state.save();

      // 对于 OPEN 比赛，也需要在提交后创建/更新 ContestPlayer（与其他赛制一致）
      if (contest.type === 'open') {
        await contest.newSubmission(judge_state);
      }
    } else {
      if (!await problem.isAllowedUseBy(submitAsUser)) throw new ErrorMessage('您没有权限进行此操作。');
      judge_state.type = 0;
      await judge_state.save();
    }
    await judge_state.updateRelatedInfo(true);

    const lang = (problem.getVJudgeLanguages() || syzoj.languages)[req.body.language];

    if (problem.type !== 'submit-answer' && lang.format) {
      let key = syzoj.utils.getFormattedCodeKey(judge_state.code, lang.format);
      let formattedCode = await FormattedCode.findOne({
        where: {
          key: key
        }
      });

      if (!formattedCode) {
        let formatted = await CodeFormatter(judge_state.code, lang.format);
        if (formatted) {
          formattedCode = await FormattedCode.create({
            key: key,
            code: formatted
          });

          try {
            await formattedCode.save();
          } catch (e) {}
        }
      }
    }

    try {
      await Judger.judge(judge_state, problem, contest_id ? 3 : 2);
      judge_state.pending = true;
      judge_state.status = 'Waiting';
      await judge_state.save();
    } catch (err) {
      console.log(err);
      throw new ErrorMessage(`无法开始评测：${err.toString()}`);
    }

    if (contest && (!await contest.isSupervisior(curUser))) {
      res.redirect(syzoj.utils.makeUrl(['contest', contest_id, 'submissions']));
    } else {
      res.redirect(syzoj.utils.makeUrl(['submission', judge_state.id]));
    }
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/delete', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    if (!await problem.isAllowedManageBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.delete();

    res.redirect(syzoj.utils.makeUrl(['problem']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/testdata', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let testdata = await problem.listTestdata();
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user)

    res.render('problem_data', {
      problem: problem,
      testdata: testdata,
      testcases: testcases
    });
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/testdata/upload', app.multer.array('file'), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.files) {
      for (let file of req.files) {
        await problem.uploadTestdataSingleFile(file.originalname, file.path, file.size, await res.locals.user.hasPrivilege('manage_problem'));
      }
    }

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'testdata']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/testdata/delete/:filename', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');
    
    await problem.deleteTestdataSingleFile(req.params.filename);

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'testdata']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

function downloadOrRedirect(req, res, filename, sendName) {
  if (syzoj.config.site_for_download) {
    res.redirect(syzoj.config.site_for_download + syzoj.utils.makeUrl(['api', 'v2', 'download', jwt.sign({
      filename: filename,
      sendName: sendName,
      originUrl: syzoj.utils.getCurrentLocation(req)
    }, syzoj.config.session_secret, {
      expiresIn: '2m'
    })]));
  } else {
    res.download(filename, sendName);
  }
}

app.get('/problem/:id/testdata/download/:filename?', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');

    if (!req.params.filename) {
      if (!await syzoj.utils.isFile(problem.getTestdataArchivePath())) {
        await problem.makeTestdataZip();
      }
    }

    let path = require('path');
    let filename = req.params.filename ? path.join(problem.getTestdataPath(), req.params.filename) : (problem.getTestdataArchivePath());
    if (!await syzoj.utils.isFile(filename)) throw new ErrorMessage('文件不存在。');

    downloadOrRedirect(req, res, filename, path.basename(filename));
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/testdata/preview/:filename', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    // 仅允许有编辑权限的用户在数据管理页进行预览
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');

    let path = require('path');
    let filename = path.join(problem.getTestdataPath(), req.params.filename);
    if (!await syzoj.utils.isFile(filename)) throw new ErrorMessage('文件不存在。');

    const stat = await fs.stat(filename);
    const MAX_BYTES = 64 * 1024; // 64KB 预览
    const readBytes = Math.min(stat.size, MAX_BYTES);

    // 读取前 MAX_BYTES 字节
    const fd = await fs.open(filename, 'r');
    try {
      const buffer = Buffer.alloc(readBytes);
      await fs.read(fd, buffer, 0, readBytes, 0);
      const content = buffer.toString('utf8');
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.send({ success: true, filename: req.params.filename, truncated: stat.size > MAX_BYTES, content });
    } finally {
      await fs.close(fd);
    }
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.send({ success: false, error: e.toString ? e.toString() : e });
  }
});

app.get('/problem/:id/download/additional_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');

    // XXX: Reduce duplication (see the '/problem/:id/submit' handler)
    let contest_id = parseInt(req.query.contest_id);
    if (contest_id) {
      let contest = await Contest.findById(contest_id);
      if (!contest) throw new ErrorMessage('无此比赛。');
      if (!contest.isRunning()) throw new ErrorMessage('比赛未开始或已结束。');
      let problems_id = await contest.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    downloadOrRedirect(req, res, problem.additional_file.getPath(), `additional_file_${id}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/statistics/:type', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let count = await problem.countStatistics(req.params.type);
    if (count === null) throw new ErrorMessage('无此统计类型。');

    let paginate = syzoj.utils.paginate(count, req.query.page, syzoj.config.page.problem_statistics);
    let statistics = await problem.getStatistics(req.params.type, paginate);

    await statistics.judge_state.forEachAsync(async x => x.loadRelationships());

    res.render('statistics', {
      statistics: statistics,
      paginate: paginate,
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

/*
app.post('/problem/:id/custom-test', app.multer.fields([{ name: 'code_upload', maxCount: 1 }, { name: 'input_file', maxCount: 1 }]), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': syzoj.utils.makeUrl(['problem', id]) }) });
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let filepath;
    if (req.files['input_file']) {
      if (req.files['input_file'][0].size > syzoj.config.limit.custom_test_input) throw new ErrorMessage('输入数据过长。');
      filepath = req.files['input_file'][0].path;
    } else {
      if (req.body.input_file_textarea.length > syzoj.config.limit.custom_test_input) throw new ErrorMessage('输入数据过长。');
      filepath = await require('tmp-promise').tmpName({ template: '/tmp/tmp-XXXXXX' });
      await require('fs-extra').writeFileAsync(filepath, req.body.input_file_textarea);
    }

    let code;
    if (req.files['code_upload']) {
      if (req.files['code_upload'][0].size > syzoj.config.limit.submit_code) throw new ErrorMessage('代码过长。');
      code = (await require('fs-extra').readFileAsync(req.files['code_upload'][0].path)).toString();
    } else {
      if (Buffer.from(req.body.code).length > syzoj.config.limit.submit_code) throw new ErrorMessage('代码过长。');
      code = req.body.code;
    }

    let custom_test = await CustomTest.create({
      input_filepath: filepath,
      code: code,
      language: req.body.language,
      user_id: res.locals.user.id,
      problem_id: id
    });

    await custom_test.save();

    let waiting_judge = await WaitingJudge.create({
      judge_id: custom_test.id,
      priority: 3,
      type: 'custom_test'
    });

    await waiting_judge.save();

    res.send({
      id: custom_test.id
    });
  } catch (e) {
    syzoj.log(e);
    res.send({
      err: e
    });
  }
});
*/
