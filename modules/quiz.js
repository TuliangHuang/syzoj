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

app.get('/quiz/:id/question/:qid', async (req, res) => {
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

    function sumPoints(arr) {
      if (!arr || !arr.length) return 0;
      return arr.reduce((s, it) => s + (Number(it.points) || 0), 0);
    }

    const originalTotalPoints = sumPoints(rendered.items || []);

    let itemsForView = rendered.items || [];
    let showAllPoints = rendered.showAllPoints;
    if (entry.points != null && isFinite(entry.points)) {
      const total = originalTotalPoints;
      if (total > 0) {
        const scale = Number(entry.points) / total;
        itemsForView = (rendered.items || []).map(it => Object.assign({}, it, { points: (Number(it.points) || 0) * scale }));
      } else {
        itemsForView = (rendered.items || []).map(it => Object.assign({}, it, { points: 0 }));
      }
      showAllPoints = true;
    }

    // Limit directory to exactly up to 11 items: window [qid-5, qid+5]
    const totalItems = items.length;
    const windowSize = 11;
    let start = 1, end = totalItems;
    if (totalItems > windowSize) {
      start = qid - 5;
      if (start < 1) start = 1;
      end = start + windowSize - 1; // ensure size 11
      if (end > totalItems) {
        end = totalItems;
        start = Math.max(1, end - windowSize + 1);
      }
    }
    const indices = [];
    for (let i = start - 1; i <= end - 1; i++) indices.push(i);

    const dir = await Promise.all(indices.map(async (idx) => {
      const it = items[idx];
      const q = await Question.findById(it.question_id);
      // Compute total points for menu: use explicit quiz points if set; otherwise sum original question points
      let totalPts = (it.points != null && isFinite(it.points)) ? Number(it.points) : null;
      if (totalPts == null) {
        let parentQ = null;
        if (q && q.parent_id) parentQ = await Question.findById(q.parent_id);
        const combined = [parentQ && parentQ.description ? parentQ.description : '', q ? (q.description || '') : ''].filter(Boolean).join('\n\n');
        const r = await syzoj.utils.renderQuestion(combined);
        totalPts = sumPoints(r.items || []);
      }
      return {
        idx: idx + 1,
        id: it.question_id,
        title: q ? (q.title || ('#' + q.id)) : ('#' + it.question_id),
        points: totalPts || 0,
        url: syzoj.utils.makeUrl(['quiz', quizId, 'question', idx + 1])
      };
    }));

    res.render('quiz_question', {
      quiz,
      qid,
      dir,
      question,
      parent,
      descriptionHtml: rendered.description,
      items: itemsForView,
      numberingMode: rendered.numberingMode,
      showAllPoints,
      points: (entry.points != null && isFinite(entry.points)) ? Number(entry.points) : originalTotalPoints,
      prevUrl: qid > 1 ? syzoj.utils.makeUrl(['quiz', quizId, 'question', qid - 1]) : null,
      nextUrl: qid < items.length ? syzoj.utils.makeUrl(['quiz', quizId, 'question', qid + 1]) : null
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
    const lines = items.map(it => {
      const pts = it.points;
      return (pts != null && isFinite(pts)) ? `${it.question_id} ${pts}` : `${it.question_id}`;
    }).join('\n');

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
      let pts = parts.length > 1 ? parseFloat(parts[1]) : null;
      if (!(qid > 0)) continue;
      if (!isFinite(pts)) pts = null;
      const item = { question_id: qid };
      if (pts != null) item.points = pts;
      items.push(item);
    }

    if (!items.length) throw new ErrorMessage('题目列表不能为空。');

    quiz.title = title || quiz.title || '未命名小测';
    quiz.description = description;
    await quiz.setItems(items);
    await quiz.save();

    res.redirect(syzoj.utils.makeUrl(['quiz', quiz.id, 'question', 1]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});


