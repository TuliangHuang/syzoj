let Quiz = syzoj.model('quiz');
let Question = syzoj.model('question');
let QuizAttempt = syzoj.model('quiz_attempt');

app.get('/quiz/:id', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const quiz = await Quiz.findById(quizId);
    if (!quiz) throw new ErrorMessage('无此小测。');

    const items = await quiz.getItems();
    function sumPoints(arr) {
      if (!arr || !arr.length) return 0;
      return arr.reduce((s, it) => s + (Number(it.points) || 0), 0);
    }

    const questions = await Promise.all(items.map(async (it, idx) => {
      const q = await Question.findById(it.question_id);
      let totalPts = (it.points != null && isFinite(it.points)) ? Number(it.points) : null;
      if (totalPts == null) {
        let parentQ = null;
        if (q && q.parent_id) parentQ = await Question.findById(q.parent_id);
        const combined = [parentQ && parentQ.description ? parentQ.description : '', q ? (q.description || '') : ''].filter(Boolean).join('\n\n');
        const r = await syzoj.utils.renderQuestion(combined);
        totalPts = sumPoints(r.items || []);
      }
      let examTags = [];
      try {
        if (q) examTags = await q.getExamTags();
      } catch (e) { examTags = []; }
      return {
        idx: idx + 1,
        id: it.question_id,
        type: q ? (q.type || null) : null,
        examTags,
        points: totalPts || 0,
        url: syzoj.utils.makeUrl(['quiz', quizId, 'question', idx + 1])
      };
    }));

    const totalPoints = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);

    // Latest attempt for current user
    let latestAttempt = null;
    if (res.locals.user) {
      try {
        latestAttempt = await QuizAttempt.findOne({
          where: { user_id: res.locals.user.id, quiz_id: quizId },
          order: { id: 'DESC' }
        });
      } catch (e) {}
    }

    // Attach earned points (if any) from latest attempt
    if (latestAttempt) {
      try {
        const ans = await latestAttempt.getAnswers();
        for (const q of questions) {
          const a = ans[q.id];
          if (a && typeof a.points === 'number') q.earned = a.points;
          else q.earned = null;
        }
      } catch (e) {}
    }
    // Compute earned total over graded items (ignore ungraded/null)
    let earnedTotal = null;
    if (latestAttempt) {
      const graded = questions.filter(q => typeof q.earned === 'number');
      if (graded.length) earnedTotal = graded.reduce((s, q) => s + (Number(q.earned) || 0), 0);
    }

    res.render('quiz', { quiz, questions, totalPoints, latestAttempt, earnedTotal });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

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

// Create a new attempt and go to first question
app.post('/quiz/:id/attempt/start', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const quiz = await Quiz.findById(quizId);
    if (!quiz) throw new ErrorMessage('无此小测。');
    if (!res.locals.user) throw new ErrorMessage('请先登录。');

    const attempt = await QuizAttempt.create();
    attempt.user_id = res.locals.user.id;
    attempt.quiz_id = quizId;
    await attempt.setAnswers({});
    await attempt.save();

    res.redirect(syzoj.utils.makeUrl(['quiz', quizId, 'question', 1], { aid: attempt.id }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Restart (create a new attempt)
app.post('/quiz/:id/attempt/restart', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const quiz = await Quiz.findById(quizId);
    if (!quiz) throw new ErrorMessage('无此小测。');
    if (!res.locals.user) throw new ErrorMessage('请先登录。');

    // If latest attempt has no effective progress, reuse it instead of creating a new one
    let latest = await QuizAttempt.findOne({ where: { user_id: res.locals.user.id, quiz_id: quizId }, order: { id: 'DESC' } });
    if (latest) {
      try {
        const ans = await latest.getAnswers();
        const keys = Object.keys(ans || {});
        let hasAny = false;
        for (const k of keys) {
          const rec = ans[k];
          if (!rec) continue;
          const arr = Array.isArray(rec.answer) ? rec.answer : [];
          // consider answered if any item has non-empty string
          if (arr.some(v => typeof v === 'string' && v.trim().length > 0)) { hasAny = true; break; }
        }
        if (!hasAny) {
          return res.redirect(syzoj.utils.makeUrl(['quiz', quizId, 'question', 1], { aid: latest.id }));
        }
      } catch (e) {}
    }

    const attempt = await QuizAttempt.create();
    attempt.user_id = res.locals.user.id;
    attempt.quiz_id = quizId;
    await attempt.setAnswers({});
    await attempt.save();

    res.redirect(syzoj.utils.makeUrl(['quiz', quizId, 'question', 1], { aid: attempt.id }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

app.get('/quiz/:id/question/:qid', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const qid = parseInt(req.params.qid);
    const aid = parseInt(req.query.aid) || 0;

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

    // Limit directory to up to 10 items: window [qid-3, qid+6]
    const totalItems = items.length;
    const windowSize = 10;
    let start = qid - 3;
    if (start < 1) start = 1;
    let end = start + windowSize - 1;
    if (end > totalItems) {
      end = totalItems;
      start = Math.max(1, end - windowSize + 1);
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
        url: syzoj.utils.makeUrl(['quiz', quizId, 'question', idx + 1], aid ? { aid } : null)
      };
    }));

    // Determine attempt and existing answers for this question
    let attempt = null;
    let existingAnswers = [];
    if (res.locals.user) {
      try {
        if (aid) {
          attempt = await QuizAttempt.findById(aid);
          if (!attempt || attempt.user_id !== res.locals.user.id || attempt.quiz_id !== quizId) attempt = null;
        }
        if (!attempt) {
          attempt = await QuizAttempt.findOne({ where: { user_id: res.locals.user.id, quiz_id: quizId }, order: { id: 'DESC' } });
        }
        if (attempt) {
          const ans = await attempt.getAnswers();
          const perQuestion = ans[entry.question_id] || null;
          existingAnswers = perQuestion && Array.isArray(perQuestion.answer) ? perQuestion.answer : [];
        }
      } catch (e) {}
    }

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
      prevUrl: qid > 1 ? syzoj.utils.makeUrl(['quiz', quizId, 'question', qid - 1], attempt ? { aid: attempt.id } : null) : null,
      nextUrl: qid < items.length ? syzoj.utils.makeUrl(['quiz', quizId, 'question', qid + 1], attempt ? { aid: attempt.id } : null) : null,
      aid: attempt ? attempt.id : null,
      existingAnswers
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});

// Save answers for a question within an attempt
app.post('/quiz/:id/question/:qid/save', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const qid = parseInt(req.params.qid);
    const aid = parseInt(req.query.aid || req.body.aid);

    const quiz = await Quiz.findById(quizId);
    if (!quiz) throw new ErrorMessage('无此小测。');
    if (!res.locals.user) throw new ErrorMessage('请先登录。');

    let attempt = await QuizAttempt.findById(aid);
    if (!attempt || attempt.user_id !== res.locals.user.id || attempt.quiz_id !== quizId) throw new ErrorMessage('无效的作答记录。');

    const items = await quiz.getItems();
    if (!qid || qid < 1 || qid > items.length) throw new ErrorMessage('无此题目。');
    const entry = items[qid - 1];

    // Collect answers from form: expecting fields like a_0, a_1, ...
    // Each item produces a single string according to type mapping
    const collected = [];
    let idx = 0;
    while (true) {
      const key = 'a_' + idx;
      if (!(key in req.body)) {
        if (idx === 0) break; // allow no answers when zero items
        else break;
      }
      let val = req.body[key];
      if (Array.isArray(val)) {
        // For multi-select, normalize: unique, uppercase letters, sort lexicographically, join as string like "AB"
        const set = Array.from(new Set(val.map(x => String(x).trim().toUpperCase()).filter(Boolean)));
        set.sort();
        val = set.join('');
      } else {
        val = String(val || '').trim();
      }
      collected.push(val);
      idx++;
    }

    // Compute grading based on standard answers and per-item points
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
    if (entry.points != null && isFinite(entry.points)) {
      const total = originalTotalPoints;
      if (total > 0) {
        const scale = Number(entry.points) / total;
        itemsForView = (rendered.items || []).map(it => Object.assign({}, it, { points: (Number(it.points) || 0) * scale }));
      } else {
        itemsForView = (rendered.items || []).map(it => Object.assign({}, it, { points: 0 }));
      }
    }

    // Prepare standard answers from question.answer (i-th line per item)
    const stdLines = (question.answer || '').split(/\r?\n/);
    let totalEarned = 0;
    let hasManual = false;
    for (let i = 0; i < itemsForView.length; i++) {
      const item = itemsForView[i] || {};
      const stdRaw = (stdLines[i] || '').trim();
      const stuRaw = (collected[i] || '').trim();
      if (!stdRaw) { hasManual = true; continue; }
      let correct = false;
      if (item.type === 'ms') {
        const norm = s => Array.from(new Set(String(s).toUpperCase().replace(/[^A-Z]/g, '').split(''))).sort().join('');
        correct = norm(stuRaw) === norm(stdRaw);
      } else if (item.type === 'mc') {
        correct = String(stuRaw).toUpperCase() === String(stdRaw).toUpperCase();
      } else if (item.type === 'tf') {
        const map = s => (String(s).trim().toUpperCase().startsWith('T') ? 'T' : 'F');
        correct = map(stuRaw) === map(stdRaw);
      } else {
        // cl / fr (and others): strict compare after trim
        correct = stuRaw === stdRaw;
      }
      if (correct) totalEarned += Number(item.points) || 0;
    }

    const answers = await attempt.getAnswers();
    answers[entry.question_id] = { answer: collected, points: hasManual ? null : totalEarned, auto_points: totalEarned, has_manual: hasManual };
    await attempt.setAnswers(answers);
    await attempt.save();

    // redirect to next or stay
    const to = req.body.next ? syzoj.utils.makeUrl(['quiz', quizId, 'question', Math.min(qid + 1, items.length)], { aid: attempt.id })
                             : syzoj.utils.makeUrl(['quiz', quizId, 'question', qid], { aid: attempt.id });
    res.redirect(to);
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

    res.redirect(syzoj.utils.makeUrl(['quiz', quiz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});


