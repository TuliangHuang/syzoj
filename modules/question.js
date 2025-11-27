let Question = syzoj.model('question');
let QuestionTag = syzoj.model('question_tag');
let QuestionTagMap = syzoj.model('question_tag_map');

const { tagColorOrder } = require('../constants');

// View question detail
app.get('/question/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const question = await Question.findById(id);
    if (!question) throw new ErrorMessage('无此题目。');

    let parent = null;
    if (question.parent_id) {
      parent = await Question.findById(question.parent_id);
    }

    question.tags = await question.getTags();

    const combinedMarkdown = [
      parent && parent.description ? parent.description : '',
      question.description || ''
    ].filter(Boolean).join('\n\n');

    const rendered = await syzoj.utils.renderQuestion(combinedMarkdown);

    const allowedEdit = res.locals.user && await res.locals.user.hasPrivilege('manage_problem');
    const canViewSolutions = allowedEdit || (syzoj.config && syzoj.config.allow_solutions_for_non_privileged === true);

    let answerHtml = null, tutorialHtml = null;
    if (canViewSolutions) {
      answerHtml = question.answer ? await syzoj.utils.markdown(question.answer) : null;
      tutorialHtml = question.tutorial ? await syzoj.utils.markdown(question.tutorial) : null;
    }

    // Navigation: either show prev/next by ID, or a random button for tag-random context
    let prevUrl = null, nextUrl = null, randomUrl = null;
    const tagIDsParam = (req.query.tagIDs || '').toString().trim();
    if (tagIDsParam) {
      randomUrl = syzoj.utils.makeUrl(['questions', 'tag', tagIDsParam, 'random']);
    } else {
      try {
        // previous: max id < current id
        const prev = await Question.findOne({
          where: { id: TypeORM.LessThan(id) },
          order: { id: 'DESC' }
        });
        if (prev) prevUrl = syzoj.utils.makeUrl(['question', prev.id]);
      } catch (e) {}
      try {
        // next: min id > current id
        const next = await Question.findOne({
          where: { id: TypeORM.MoreThan(id) },
          order: { id: 'ASC' }
        });
        if (next) nextUrl = syzoj.utils.makeUrl(['question', next.id]);
      } catch (e) {}
    }

    res.render('question', {
      question,
      parent,
      description: rendered.description,
      items: rendered.items || [],
      numberingMode: rendered.numberingMode,
      showAllPoints: rendered.showAllPoints,
      submitted: req.query.submitted === '1',
      tagColorOrder,
      allowedEdit,
      answerHtml,
      tutorialHtml,
      prevUrl,
      nextUrl,
      randomUrl,
      canViewSolutions
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Receive question submit
app.post('/question/:id/submit', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // TODO: persist submission if needed
    res.redirect(syzoj.utils.makeUrl(['question', id], { submitted: 1 }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// List questions
app.get('/questions', async (req, res) => {
  try {
    const sort = req.query.sort || 'id';
    const order = req.query.order || 'asc';
    if (!['id', 'title'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Question.createQueryBuilder();
    query.orderBy(sort, order.toUpperCase());

    let paginate = syzoj.utils.paginate(await Question.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let questions = await Question.queryPage(paginate, query);

    await questions.forEachAsync(async question => {
      question.tags = await question.getTags();
    });

    const allTags = await QuestionTag.find({ order: { name: 'ASC' } });
    res.render('questions', {
      questions: questions,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc',
      allTags: allTags,
      tagColorOrder,
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      allowedManageProblem: res.locals.user && await res.locals.user.hasPrivilege('manage_problem'),
      showSolutionsForUser: syzoj.config && syzoj.config.allow_solutions_for_non_privileged === true,
      isAdmin: !!(res.locals.user && res.locals.user.is_admin)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Search questions
app.get('/questions/search', async (req, res) => {
  try {
    let id = parseInt(req.query.keyword) || 0;
    const keyword = String(req.query.keyword || '').trim();
    const sort = req.query.sort || 'id';
    const order = req.query.order || 'desc';
    if (!['id', 'title'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Question.createQueryBuilder();
    query.where('title LIKE :title', { title: `%${keyword}%` })
         .orWhere('id = :id', { id: id });

    query.orderBy('id = ' + id.toString(), 'DESC');
    query.addOrderBy(sort, order.toUpperCase());

    let paginate = syzoj.utils.paginate(await Question.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let questions = await Question.queryPage(paginate, query);

    await questions.forEachAsync(async question => {
      question.tags = await question.getTags();
    });

    const allTags = await QuestionTag.find({ order: { name: 'ASC' } });
    res.render('questions', {
      questions: questions,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc',
      allTags: allTags,
      tagColorOrder,
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      allowedManageProblem: res.locals.user && await res.locals.user.hasPrivilege('manage_problem'),
      showSolutionsForUser: syzoj.config && syzoj.config.allow_solutions_for_non_privileged === true,
      isAdmin: !!(res.locals.user && res.locals.user.is_admin)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// (moved) question tag routes are now in web/modules/question_tag.js

// Toggle showing solutions for non-privileged users (admin-only, site-wide)
app.post('/questions/toggle-solutions', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const on = String(req.body.on || '0') === '1';
    if (!syzoj.configInFile) syzoj.configInFile = {};
    syzoj.configInFile.allow_solutions_for_non_privileged = on;
    syzoj.reloadConfig();
    await syzoj.utils.saveConfig();
    res.json({ ok: true, on });
  } catch (e) {
    syzoj.log(e);
    res.status(500).json({ ok: false, error: e && e.message });
  }
});

// Create / edit question
app.get('/question/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let question = await Question.findById(id);

    if (!question) {
      question = await Question.create();
      question.id = id || undefined;
      question.new = true;
      question.tags = [];
      question.allowedManage = true;
      question.allowedEdit = true;
    } else {
      question.tags = await question.getTags();
      question.allowedManage = true;
      question.allowedEdit = true;
    }

    res.render('question_edit', { question });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.post('/question/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let question = await Question.findById(id);

    if (!question) {
      question = await Question.create();
      if (id) question.id = id;
      question.new = true;
    }

    function normalizeNullableNumber(v) {
      if (v == null || v === '') return null;
      const n = parseInt(v);
      return isNaN(n) ? null : n;
    }
    question.parent_id = normalizeNullableNumber(req.body.parent_id);
    question.title = req.body.title;
    question.type = (req.body.type || '').trim() || null;
    question.source = req.body.source;
    question.description = req.body.description;
    question.answer = req.body.answer;
    question.tutorial = req.body.tutorial;
    const boolInput = (req.body.is_double_column || '').toString().toLowerCase();
    question.is_double_column = boolInput === 'on' || boolInput === '1' || boolInput === 'true';

    if (!question.title) throw new ErrorMessage('题目名不能为空。');

    // Allow admin to change ID similar to problem flow
    if (await res.locals.user.hasPrivilege('manage_problem')) {
      let customID = parseInt(req.body.id);
      if (customID && customID !== id) {
        if (await Question.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        if (question.new) {
          // New question: set explicit ID before first save to avoid WHERE `id` = undefined
          question.id = customID;
        } else {
          await question.changeID(customID);
        }
        id = customID;
      }
    }

    await question.save();

    // Tags
    if (!req.body.tags) req.body.tags = [];
    else if (!Array.isArray(req.body.tags)) req.body.tags = [req.body.tags];
    let newTagIDs = await req.body.tags.map(x => parseInt(x)).filterAsync(async x => QuestionTag.findById(x));
    await question.setTags(newTagIDs);

    res.redirect(syzoj.utils.makeUrl(['question', question.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});
