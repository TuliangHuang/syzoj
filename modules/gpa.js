app.get('/gpa', async (req, res) => {
  try {
    res.render('gpa', {});
  } catch (e) {
    syzoj.log(e);
    res.render('error', { err: e });
  }
});
