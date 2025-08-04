let Problem = syzoj.model('problem');

app.get('/problem/:id/import', async (req, res) => {
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
      problem.new = true;
      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    res.render('problem_import', {
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/import', async (req, res) => {
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
    }

    let request = require('request-promise');
    let json = await request({
      uri: req.body.url + (req.body.url.endsWith('/') ? 'export' : '/export'),
      timeout: 1500,
      json: true
    });

    if (!json.success) throw new ErrorMessage('题目加载失败。', null, json.error);

    if (!json.obj.title.trim()) throw new ErrorMessage('题目名不能为空。');
    problem.title = json.obj.title;
    problem.description = json.obj.description;
    problem.input_format = json.obj.input_format;
    problem.output_format = json.obj.output_format;
    problem.example = json.obj.example;
    problem.limit_and_hint = json.obj.limit_and_hint;
    problem.time_limit = json.obj.time_limit;
    problem.memory_limit = json.obj.memory_limit;
    problem.file_io = json.obj.file_io;
    problem.file_io_input_name = json.obj.file_io_input_name;
    problem.file_io_output_name = json.obj.file_io_output_name;
    if (json.obj.type) problem.type = json.obj.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    await problem.save();

    let tagIDs = (await json.obj.tags.mapAsync(name => ProblemTag.findOne({ where: { name: String(name) } }))).filter(x => x).map(tag => tag.id);
    await problem.setTags(tagIDs);

    let download = require('download');
    let tmp = require('tmp-promise');
    let tmpFile = await tmp.file();

    try {
      let data = await download(req.body.url + (req.body.url.endsWith('/') ? 'testdata/download' : '/testdata/download'));
      await fs.writeFile(tmpFile.path, data);
      await problem.updateTestdata(tmpFile.path, await res.locals.user.hasPrivilege('manage_problem'));
      if (json.obj.have_additional_file) {
        let additional_file = await download(req.body.url + (req.body.url.endsWith('/') ? 'download/additional_file' : '/download/additional_file'));
        await fs.writeFile(tmpFile.path, additional_file);
        await problem.updateFile(tmpFile.path, 'additional_file', await res.locals.user.hasPrivilege('manage_problem'));
      }
    } catch (e) {
      syzoj.log(e);
    }

    res.redirect(syzoj.utils.makeUrl(['problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
