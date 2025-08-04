let Problem = syzoj.model('problem');
let ProblemTag = syzoj.model('problem_tag');

app.get('/problems/tag/:tagIDs', async (req, res) => {
  try {
    let tagIDs = Array.from(new Set(req.params.tagIDs.split(',').map(x => parseInt(x))));
    let tags = await tagIDs.mapAsync(async tagID => ProblemTag.findById(tagID));
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let sortVal;
    if (sort === 'ac_rate') {
      sortVal = '`problem`.`ac_num` / `problem`.`submit_num`';
    } else {
      sortVal = '`problem`.`' + sort + '`';
    }

    // Validate the tagIDs
    for (let tag of tags) {
      if (!tag) {
        return res.redirect(syzoj.utils.makeUrl(['problems']));
      }
    }

    let sql = 'SELECT `id` FROM `problem` WHERE\n';
    for (let tagID of tagIDs) {
      if (tagID !== tagIDs[0]) {
        sql += 'AND\n';
      }

      sql += '`problem`.`id` IN (SELECT `problem_id` FROM `problem_tag_map` WHERE `tag_id` = ' + tagID + ')';
    }

    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
      if (res.locals.user) {
        sql += 'AND (`problem`.`is_public` = 1 OR `problem`.`user_id` = ' + res.locals.user.id + ')';
      } else {
        sql += 'AND (`problem`.`is_public` = 1)';
      }
    }

    let paginate = syzoj.utils.paginate(await Problem.countQuery(sql), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.query(sql + ` ORDER BY ${sortVal} ${order} ` + paginate.toSQL());

    problems = await problems.mapAsync(async problem => {
      // query() returns plain objects.
      problem = await Problem.findById(problem.id);

      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.judge_state = await problem.getJudgeState(res.locals.user, true);
      problem.tags = await problem.getTags();

      return problem;
    });

    res.render('problems', {
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      tags: tags,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problems/tag/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem_tag')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let tag = await ProblemTag.findById(id);

    if (!tag) {
      tag = await ProblemTag.create();
      tag.id = id;
    }

    res.render('problem_tag_edit', {
      tag: tag
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problems/tag/:id/edit', async (req, res) => {
  try {
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem_tag')) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.params.id) || 0;
    let tag = await ProblemTag.findById(id);

    if (!tag) {
      tag = await ProblemTag.create();
      tag.id = id;
    }

    req.body.name = req.body.name.trim();
    if (tag.name !== req.body.name) {
      if (await ProblemTag.findOne({ where: { name: String(req.body.name) } })) {
        throw new ErrorMessage('标签名称已被使用。');
      }
    }

    tag.name = req.body.name;
    tag.color = req.body.color;

    await tag.save();

    res.redirect(syzoj.utils.makeUrl(['problems', 'tag', tag.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
