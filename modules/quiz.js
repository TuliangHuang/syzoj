let Quiz = syzoj.model('quiz');
let Question = syzoj.model('question');

app.get('/quizzes', async (req, res) => {
  try {
    let paginate = syzoj.utils.paginate(await Quiz.countForPagination({}), req.query.page, syzoj.config.page.contest);
    let quizzes = await Quiz.queryPage(paginate, {}, { id: 'DESC' });
    const itemsCount = await Promise.all(quizzes.map(async q => (await q.getItems()).length));
    const list = quizzes.map((q, idx) => ({ quiz: q, count: itemsCount[idx] }));

    res.render('quizzes', {
      quizzes: list,
      paginate: paginate
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.get('/quiz/:id/:qid', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const qid = parseInt(req.params.qid);

    const quiz = await Quiz.findById(quizId);
    if (!quiz) throw new ErrorMessage('无此小测。');

    const items = await quiz.getItems();
    if (!items.length) throw new ErrorMessage('该小测尚未添加题目。');

    if (!qid || qid < 1 || qid > items.length) throw new ErrorMessage('无此题目。');

    const entry = items[qid - 1];
    const question = await Question.findById(entry.question_id);
    if (!question) throw new ErrorMessage('题目不存在。');

    let parent = null;
    if (question.parent_id) parent = await Question.findById(question.parent_id);

    const combinedMarkdown = [
      parent && parent.description ? parent.description : '',
      question.description || ''
    ].filter(Boolean).join('\n\n');

    const rendered = await syzoj.utils.renderQuestion(combinedMarkdown);

    const dir = await Promise.all(items.map(async (it, idx) => {
      const q = await Question.findById(it.question_id);
      return {
        idx: idx + 1,
        id: it.question_id,
        title: q ? (q.title || ('#' + q.id)) : ('#' + it.question_id),
        points: it.points || 0,
        url: syzoj.utils.makeUrl(['quiz', quizId, idx + 1])
      };
    }));

    res.render('quiz_question', {
      quiz,
      qid,
      dir,
      question,
      parent,
      descriptionHtml: rendered.description,
      items: rendered.items || [],
      numberingMode: rendered.numberingMode,
      showAllPoints: rendered.showAllPoints,
      points: entry.points || 0,
      prevUrl: qid > 1 ? syzoj.utils.makeUrl(['quiz', quizId, qid - 1]) : null,
      nextUrl: qid < items.length ? syzoj.utils.makeUrl(['quiz', quizId, qid + 1]) : null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.get('/quiz/:id/edit', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    let quiz = await Quiz.findById(quizId);

    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (!quiz) {
      quiz = await Quiz.create();
      quiz.id = 0;
      await quiz.setItems([]);
    }

    const items = await quiz.getItems();
    const lines = items.map(it => `${it.question_id} ${it.points || 0}`).join('\n');

    res.render('quiz_edit', {
      quiz,
      lines
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.post('/quiz/:id/edit', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    let quiz = await Quiz.findById(quizId);

    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (!quiz) {
      quiz = await Quiz.create();
    }

    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const lines = (req.body.lines || '').split('\n');

    let items = [];
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      const parts = line.replace(/[,，]/g, ' ').split(/\s+/);
      const qid = parseInt(parts[0]);
      let pts = parts.length > 1 ? parseFloat(parts[1]) : 0;
      if (!(qid > 0)) continue;
      if (!isFinite(pts)) pts = 0;
      items.push({ question_id: qid, points: pts });
    }

    if (!items.length) throw new ErrorMessage('题目列表不能为空。');

    quiz.title = title || quiz.title || '未命名小测';
    quiz.description = description;
    await quiz.setItems(items);
    await quiz.save();

    res.redirect(syzoj.utils.makeUrl(['quiz', quiz.id, 1]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});


