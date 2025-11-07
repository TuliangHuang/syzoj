let Question = syzoj.model('question');
let QuestionTag = syzoj.model('question_tag');
let QuestionTagMap = syzoj.model('question_tag_map');

const { tagColorOrder } = require('../constants');

// Tag filter page
app.get('/questions/tag/:tagIDs', async (req, res) => {
  try {
    let tagIDs = Array.from(new Set(req.params.tagIDs.split(',').map(x => parseInt(x)))).filter(x => x);
    let tags = await tagIDs.mapAsync(async tagID => QuestionTag.findById(tagID));
    // Reuse problem.order
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    const sortVal = '`question`.`' + sort + '`';

    for (let tag of tags) {
      if (!tag) return res.redirect(syzoj.utils.makeUrl(['questions']));
    }

    let sql = 'SELECT `id` FROM `question` WHERE\n';
    for (let tagID of tagIDs) {
      if (tagID !== tagIDs[0]) sql += 'AND\n';
      sql += '`question`.`id` IN (SELECT `question_id` FROM `question_tag_map` WHERE `tag_id` = ' + tagID + ')';
    }

    let paginate = syzoj.utils.paginate(await Question.countQuery(sql), req.query.page, syzoj.config.page.problem);
    let questions = await Question.query(sql + ` ORDER BY ${sortVal} ${order.toUpperCase()} ` + paginate.toSQL());

    questions = await questions.mapAsync(async q => {
      q = await Question.findById(q.id);
      q.tags = await q.getTags();
      return q;
    });

    const allTags = await QuestionTag.find({ order: { name: 'ASC' } });
    res.render('questions', {
      questions,
      tags,
      paginate,
      curSort: sort,
      curOrder: order === 'asc',
      allTags,
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

// Random question within tags
app.get('/questions/tag/:tagIDs/random', async (req, res) => {
  try {
    let tagIDs = Array.from(new Set(req.params.tagIDs.split(',').map(x => parseInt(x)))).filter(x => x);
    let tags = await tagIDs.mapAsync(async tagID => QuestionTag.findById(tagID));

    for (let tag of tags) {
      if (!tag) return res.redirect(syzoj.utils.makeUrl(['questions']));
    }

    let sql = 'SELECT `id` FROM `question` WHERE\n';
    for (let tagID of tagIDs) {
      if (tagID !== tagIDs[0]) sql += 'AND\n';
      sql += '`question`.`id` IN (SELECT `question_id` FROM `question_tag_map` WHERE `tag_id` = ' + tagID + ')';
    }

    let rows = await Question.query(sql + ' ORDER BY RAND() LIMIT 1');
    if (!rows || !rows.length) throw new ErrorMessage('没有符合条件的题目。');

    const qid = rows[0].id;
    res.redirect(syzoj.utils.makeUrl(['question', qid], { tagIDs: req.params.tagIDs }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Edit tag pages
app.get('/questions/tag/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem_tag')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let tag = await QuestionTag.findById(id);
    if (!tag) {
      tag = await QuestionTag.create();
      tag.id = id;
    }
    res.render('question_tag_edit', { tag });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.post('/questions/tag/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem_tag')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let tag = await QuestionTag.findById(id);
    if (!tag) {
      tag = await QuestionTag.create();
      tag.id = id;
    }

    req.body.name = String(req.body.name || '').trim();
    if (tag.name !== req.body.name) {
      if (await QuestionTag.findOne({ where: { name: String(req.body.name) } })) {
        throw new ErrorMessage('标签名称已被使用。');
      }
    }

    tag.name = req.body.name;
    tag.color = req.body.color;
    await tag.save();

    res.redirect(syzoj.utils.makeUrl(['questions', 'tag', tag.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});
