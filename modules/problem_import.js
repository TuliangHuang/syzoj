let Problem = syzoj.model('problem');
let ProblemTag = syzoj.model('problem_tag');

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

async function importFromSyzoj(problem, url) {
  if (!url.endsWith('/')) url += '/';
  let request = require('request-promise');
  let json = await request({
    uri: url + 'export',
    timeout: 1500,
    json: true
  });

  if (!json.success) throw new ErrorMessage('题目加载失败。', null, json.error);

  if (!json.obj.title.trim()) throw new ErrorMessage('题目名不能为空。');
  problem.title = json.obj.title;
  problem.source = url;
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
  if (validateMsg) throw new ErrorMessage('无效的题目数据配置（SYZOJ）。', null, validateMsg);

  let tagIDs = (await json.obj.tags.mapAsync(name => ProblemTag.findOne({ where: { name: String(name) } }))).filter(x => x).map(tag => tag.id);
  await problem.setTags(tagIDs);
  await problem.save();

  const fs = require('fs-extra');
  let download = require('download');
  let tmp = require('tmp-promise');
  let tmpFile = await tmp.file();

  try {
    let data = await download(url + 'testdata/download');
    await fs.writeFile(tmpFile.path, data);
    await problem.updateTestdata(tmpFile.path, true);
    if (json.obj.have_additional_file) {
      let additional_file = await download(url + 'download/additional_file');
      await fs.writeFile(tmpFile.path, additional_file);
      await problem.updateFile(tmpFile.path, 'additional_file', true);
    }
  } catch (e) {
    syzoj.log(e);
  }
}

async function importFromLoj(problem, url) {
  const syzojRe = /(https?):\/\/([^/]+)\/(problem|p)\/([0-9]+)\/?/i;
  var [, protocol, host, n, pid] = syzojRe.exec(url);
  pid = +pid;

  var request = require('superagent');
  require('superagent-proxy')(request);
  var proxy = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || '';
  const json = await request.post(`${protocol}://${host === 'loj.ac' ? 'api.loj.ac' : host}/api/problem/getProblem`)
    .send({
      displayId: pid,
      localizedContentsOfAllLocales: true,
      tagsOfLocale: 'zh_CN',
      samples: true,
      judgeInfo: true,
      testData: true,
      additionalFiles: true,
    })
    .proxy(proxy);

  if (!json.body.localizedContentsOfAllLocales) {
    throw new ErrorMessage('题目加载失败。');
  }

  let filter = require('lodash');
  let title = [
    ...filter(
      json.body.localizedContentsOfAllLocales,
      (node) => node.locale === 'zh_CN',
    ),
    ...json.body.localizedContentsOfAllLocales,
  ][0].title;

  for (const c of json.body.localizedContentsOfAllLocales) {
    let locale = c.locale;
    if (locale !== 'zh_CN') {
      continue;
    }

    let content = '';
    const sections = c.contentSections;
    let add = false;
    for (const section of sections) {
      if (section.type === 'Sample') {
        if (section.sampleId === 0) {
          add = true;
        }
        content += '```input' + (add ? section.sampleId + 1 : section.sampleId) + '\n';
        content += json.body.samples[section.sampleId].inputData + '\n';
        content += '```\n\n';
        content += '```output' + (add ? section.sampleId + 1 : section.sampleId) + '\n';
        content += json.body.samples[section.sampleId].outputData + '\n';
        content += '```\n';
        if (section.text) {
          content += '\n';
          content += section.text + '\n';
          content += '\n';
        }
      } else {
        content += '## ' + section.sectionTitle + '\n';
        content += '\n' + section.text + '\n\n';
      }
    }
    const result = syzoj.utils.parseMarkdown(content);
    problem.description = result.description;
    problem.input_format = result.input_format;
    problem.output_format = result.output_format;
    problem.example = result.example;
    problem.limit_and_hint = result.limit_and_hint;
  }

  let tags = json.body.tagsOfLocale.map((node) => node.name);
  let tagIDs = (await tags.mapAsync(name => ProblemTag.findOne({ where: { name: String(name) } }))).filter(x => x).map(tag => tag.id);

  problem.title = title;
  problem.source = url;
  problem.setTags(tagIDs);
  await problem.save();
}

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

    let url = req.body.url;
    const syzojRe = /(https?):\/\/([^/]+)\/(problem|p)\/([0-9]+)\/?/i;
    if (!url.match(syzojRe)) {
      throw new ErrorMessage('This is not a valid SYZOJ/Lyrio problem detail page link.');
    }
    const [, protocol, host, n, pid] = syzojRe.exec(url);
    if (n === 'p') {
      await importFromLoj(problem, url);
    } else {
      await importFromSyzoj(problem, url);
    }
    res.redirect(syzoj.utils.makeUrl(['problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
