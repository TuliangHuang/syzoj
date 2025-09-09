let Question = syzoj.model('question');
let QuestionTag = syzoj.model('question_tag');
let QuestionTagMap = syzoj.model('question_tag_map');

const { tagColorOrder } = require('../constants');

// Helpers
async function getQuestionTags(questionId) {
  let maps = await QuestionTagMap.find({
    where: { question_id: questionId }
  });
  let tagIDs = maps.map(x => x.tag_id);
  return await tagIDs.mapAsync(async tagID => QuestionTag.findById(tagID));
}

// View question detail
app.get('/question/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const question = await Question.findById(id);
    if (!question) throw new ErrorMessage('无此题目。');

    let parent = null;
    if (question.parent_uid) {
      parent = await Question.findOne({ where: { uid: question.parent_uid } });
    }

    question.tags = await getQuestionTags(question.id);

    const combinedMarkdown = [
      parent && parent.description ? parent.description : '',
      question.description || ''
    ].filter(Boolean).join('\n\n');

    const rendered = await syzoj.utils.renderQuestion(combinedMarkdown);

    const allowedEdit = res.locals.user && await res.locals.user.hasPrivilege('manage_problem');

    let answerHtml = null, tutorialHtml = null;
    if (allowedEdit) {
      answerHtml = question.answer ? await syzoj.utils.markdown(question.answer) : null;
      tutorialHtml = question.tutorial ? await syzoj.utils.markdown(question.tutorial) : null;
    }

    res.render('question', {
      question,
      parent,
      descriptionHtml: rendered.description,
      singleChoice: rendered.single,
      multiChoice: rendered.multi,
      submitted: req.query.submitted === '1',
      tagColorOrder,
      allowedEdit,
      answerHtml,
      tutorialHtml
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

async function setQuestionTags(questionId, newTagIDs) {
  let maps = await QuestionTagMap.find({ where: { question_id: questionId } });
  let oldTagIDs = maps.map(x => x.tag_id);

  let delTagIDs = oldTagIDs.filter(x => !newTagIDs.includes(x));
  let addTagIDs = newTagIDs.filter(x => !oldTagIDs.includes(x));

  for (let tagID of delTagIDs) {
    let map = await QuestionTagMap.findOne({ where: { question_id: questionId, tag_id: tagID } });
    if (map) await map.destroy();
  }

  for (let tagID of addTagIDs) {
    let map = await QuestionTagMap.create({ question_id: questionId, tag_id: tagID });
    await map.save();
  }
}

// List questions
app.get('/questions', async (req, res) => {
  try {
    const sort = req.query.sort || 'id';
    const order = req.query.order || 'asc';
    if (!['id', 'title', 'uid'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Question.createQueryBuilder();
    query.orderBy(sort, order.toUpperCase());

    let paginate = syzoj.utils.paginate(await Question.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let questions = await Question.queryPage(paginate, query);

    await questions.forEachAsync(async question => {
      question.tags = await getQuestionTags(question.id);
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
      allowedManageProblem: res.locals.user && await res.locals.user.hasPrivilege('manage_problem')
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
    if (!['id', 'title', 'uid'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Question.createQueryBuilder();
    query.where('title LIKE :title', { title: `%${keyword}%` })
         .orWhere('id = :id', { id: id })
         .orWhere('uid = :uid', { uid: keyword });

    query.orderBy('id = ' + id.toString(), 'DESC');
    query.addOrderBy(sort, order.toUpperCase());

    let paginate = syzoj.utils.paginate(await Question.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let questions = await Question.queryPage(paginate, query);

    await questions.forEachAsync(async question => {
      question.tags = await getQuestionTags(question.id);
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
      allowedManageProblem: res.locals.user && await res.locals.user.hasPrivilege('manage_problem')
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// (moved) question tag routes are now in web/modules/question_tag.js

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
    } else {
      question.tags = await getQuestionTags(question.id);
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
    }

    function normalizeNullableString(v) {
      if (v == null) return null;
      const s = String(v).trim();
      return s.length ? s : null;
    }
    question.uid = normalizeNullableString(req.body.uid);
    question.parent_uid = normalizeNullableString(req.body.parent_uid);
    question.title = req.body.title;
    question.source = req.body.source;
    question.description = req.body.description;
    question.answer = req.body.answer;
    question.tutorial = req.body.tutorial;

    if (!question.title) throw new ErrorMessage('题目名不能为空。');

    await question.save();

    // Tags
    if (!req.body.tags) req.body.tags = [];
    else if (!Array.isArray(req.body.tags)) req.body.tags = [req.body.tags];
    let newTagIDs = await req.body.tags.map(x => parseInt(x)).filterAsync(async x => QuestionTag.findById(x));
    await setQuestionTags(question.id, newTagIDs);

    res.redirect(syzoj.utils.makeUrl(['question', question.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});
