// Render the editable text layers of a PSD through Photopea's documented live API.
let templateCatalog = null;
let templateKind = '名片';
let activeTemplate = null;
let templateResultBlob = null;
let templateResultUrl = null;

async function renderTemplates() {
  const grid = document.getElementById('templateCards');
  if (!templateCatalog) {
    grid.innerHTML = '<div class="panel template-empty">正在读取模板…</div>';
    try {
      const response = await fetch('template-assets/manifest.json', {cache:'no-store'});
      if (!response.ok) throw new Error('模板目录读取失败');
      templateCatalog = await response.json();
    } catch (error) {
      grid.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'panel template-empty';
      message.textContent = error.message;
      grid.append(message);
      return;
    }
  }
  const query = document.getElementById('templateSearch').value.trim().toLocaleLowerCase();
  const matches = templateCatalog.filter(t => t.kind === templateKind &&
    (t.name + ' ' + t.fields.map(f => f.label).join(' ')).toLocaleLowerCase().includes(query));
  grid.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'panel template-empty';
    empty.textContent = query ? '没有找到匹配的' + templateKind + '模板' : '暂无' + templateKind + '模板';
    grid.append(empty);
    return;
  }
  for (const template of matches) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'panel template-card';
    const img = document.createElement('img');
    img.src = template.preview;
    img.alt = template.name + '预览';
    img.loading = 'lazy';
    const body = document.createElement('span');
    body.className = 'template-card-body';
    const title = document.createElement('strong');
    title.textContent = template.name;
    const detail = document.createElement('small');
    detail.textContent = '可修改：' + template.fields.map(f => f.label).join('、');
    body.append(title, detail);
    card.append(img, body);
    card.onclick = () => openTemplate(template);
    grid.append(card);
  }
}

document.querySelectorAll('[data-template-kind]').forEach(button => {
  button.onclick = () => {
    templateKind = button.dataset.templateKind;
    document.querySelectorAll('[data-template-kind]').forEach(b => b.classList.toggle('active', b === button));
    renderTemplates();
  };
});
document.getElementById('templateSearch').oninput = renderTemplates;

function clearTemplateResult() {
  if (templateResultUrl) URL.revokeObjectURL(templateResultUrl);
  templateResultUrl = null;
  templateResultBlob = null;
  document.getElementById('templateResult').classList.add('hidden');
  document.getElementById('templateResultImage').removeAttribute('src');
  document.getElementById('copyTemplateImage').disabled = true;
  document.getElementById('downloadTemplateImage').disabled = true;
}

function openTemplate(template) {
  activeTemplate = template;
  clearTemplateResult();
  document.getElementById('templateEditorTitle').textContent = template.name;
  document.getElementById('templateOriginalPreview').src = template.preview;
  document.getElementById('templateStatus').textContent = '';
  document.getElementById('templateProgress').classList.add('hidden');
  document.getElementById('templateProgressFill').style.width = '0%';
  document.getElementById('templateProgressFill').style.background = '';
  const fields = document.getElementById('templateFields');
  fields.replaceChildren();
  template.fields.forEach((field, index) => {
    if (field.label === '邮箱' && field.example.includes('@')) {
      const group = document.createElement('div');
      group.className = 'field';
      group.textContent = '邮箱';
      const parts = document.createElement('div');
      parts.className = 'template-email-parts';
      const localLabel = document.createElement('label');
      localLabel.textContent = '@ 前内容';
      const local = document.createElement('input');
      local.name = String(index);
      local.placeholder = field.example.split('@')[0];
      local.required = true;
      local.maxLength = 100;
      local.pattern = '[^@\\s]+';
      local.title = '只填写 @ 前的内容';
      localLabel.append(local);
      const suffixLabel = document.createElement('label');
      suffixLabel.textContent = '邮箱后缀（可修改）';
      const suffix = document.createElement('input');
      suffix.name = index + '-suffix';
      suffix.value = field.example.slice(field.example.indexOf('@'));
      suffix.required = true;
      suffix.maxLength = 100;
      suffix.pattern = '@[^@\\s]+\\.[^@\\s]+';
      suffix.title = '填写以 @ 开头的邮箱后缀，例如 @bytedances.com.cn';
      suffixLabel.append(suffix);
      parts.append(localLabel, suffixLabel);
      group.append(parts);
      fields.append(group);
      return;
    }
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.name = String(index);
    input.placeholder = field.example;
    input.required = true;
    input.maxLength = field.label === '电话' ? 32 : 160;
    if (field.label === '邮箱') input.type = 'email';
    if (field.label === '电话') {
      input.type = 'tel';
      input.inputMode = 'tel';
      input.value = field.default || field.example || '';
    }
    label.append(input);
    fields.append(label);
  });
  document.getElementById('templateEditor').showModal();
  fields.querySelector('input')?.focus();
}

document.getElementById('closeTemplateEditor').onclick = () => document.getElementById('templateEditor').close();
document.getElementById('templateEditor').addEventListener('close', clearTemplateResult);

function templateProgress(percent, message) {
  document.getElementById('templateProgress').classList.remove('hidden');
  document.getElementById('templateProgressFill').style.width = percent + '%';
  document.getElementById('templateStatus').textContent = message;
}

function photopeaMessage(frame, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let image = null;
    const timer = setTimeout(() => finish(new Error('PSD 处理超时，请重试')), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      error ? reject(error) : resolve(image);
    }
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.origin !== 'https://www.photopea.com') return;
      if (event.data instanceof ArrayBuffer) image = event.data;
      if (typeof event.data === 'string' && event.data.startsWith('TEMPLATE_ERROR:'))
        return finish(new Error(event.data.slice(15)));
      if (event.data === 'done') finish();
    }
    window.addEventListener('message', onMessage);
    if (payload !== null) frame.contentWindow.postMessage(payload, 'https://www.photopea.com');
  });
}

async function renderTemplatePSD(template, values) {
  templateProgress(5, '正在连接 PSD 编辑器…');
  const frame = document.createElement('iframe');
  frame.title = 'PSD 模板渲染器';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;pointer-events:none';
  const ready = photopeaMessage(frame, null, 90000);
  frame.src = 'https://www.photopea.com/#' + encodeURIComponent(JSON.stringify({environment:{vmode:2}}));
  document.body.append(frame);
  try {
    await ready;
    templateProgress(20, '正在读取 PSD 文件…');
    const response = await fetch(template.psd);
    if (!response.ok) throw new Error('PSD 文件下载失败');
    const psd = await response.arrayBuffer();
    templateProgress(35, '正在打开 PSD 图层…');
    await photopeaMessage(frame, psd, 90000);
    templateProgress(60, '正在替换文字图层…');
    const replacements = template.fields.map((field, i) => ({
      layer: field.layer,
      value: values[i],
      style: template.id === '名片/LV（名字+邮箱+电话）' && field.layer === '名字'
        ? 'lv-name'
        : template.id === '名片/LV（名字+邮箱+电话）' && field.layer === '电话'
          ? 'lv-phone'
          : ''
    }));
    const script = `(function(){try{var items=${JSON.stringify(replacements)};var doc=app.activeDocument;if(!doc)throw Error('PSD 没有打开');function find(group,name){for(var i=0;i<group.length;i++){var layer=group[i];if(layer.name===name)return layer;if(layer.layers){var nested=find(layer.layers,name);if(nested)return nested}}return null}for(var j=0;j<items.length;j++){var layer=find(doc.layers,items[j].layer);if(!layer||!layer.textItem)throw Error('找不到文字图层：'+items[j].layer);layer.textItem.contents=items[j].value;if(items[j].style==='lv-name'){layer.textItem.verticalScale=115;layer.textItem.horizontalScale=95}else if(items[j].style==='lv-phone'){layer.textItem.fauxBold=false;layer.textItem.horizontalScale=87.7}}doc.saveToOE('png')}catch(error){app.echoToOE('TEMPLATE_ERROR:'+error.message)}})();`;
    templateProgress(75, '正在导出 PNG 图片…');
    const png = await photopeaMessage(frame, script, 90000);
    if (!png) throw new Error('PSD 编辑器没有返回图片');
    templateProgress(100, '生成完成，可以复制或下载');
    return new Blob([png], {type:'image/png'});
  } finally {
    frame.remove();
  }
}

document.getElementById('templateForm').onsubmit = async event => {
  event.preventDefault();
  if (!activeTemplate) return;
  const button = document.getElementById('generateTemplate');
  const values = activeTemplate.fields.map((field, i) => {
    const value = document.querySelector(`#templateFields input[name="${i}"]`).value.trim();
    const suffix = document.querySelector(`#templateFields input[name="${i}-suffix"]`);
    return field.label === '邮箱' && suffix ? value + suffix.value.trim() : value;
  });
  if (values.some(v => !v)) return;
  button.disabled = true;
  clearTemplateResult();
  document.getElementById('templateProgressFill').style.background = '';
  try {
    templateResultBlob = await renderTemplatePSD(activeTemplate, values);
    templateResultUrl = URL.createObjectURL(templateResultBlob);
    document.getElementById('templateResultImage').src = templateResultUrl;
    document.getElementById('templateResult').classList.remove('hidden');
    document.getElementById('copyTemplateImage').disabled = false;
    document.getElementById('downloadTemplateImage').disabled = false;
  } catch (error) {
    document.getElementById('templateStatus').textContent = '生成失败：' + error.message;
    document.getElementById('templateProgressFill').style.background = '#e76565';
  } finally {
    button.disabled = false;
  }
};

document.getElementById('downloadTemplateImage').onclick = () => {
  if (!templateResultUrl) return;
  const link = document.createElement('a');
  link.href = templateResultUrl;
  link.download = (activeTemplate?.name || '协议模板') + '.png';
  link.click();
};
document.getElementById('copyTemplateImage').onclick = async () => {
  if (!templateResultBlob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({'image/png':templateResultBlob})]);
    document.getElementById('templateStatus').textContent = '图片已复制';
  } catch {
    document.getElementById('templateStatus').textContent = '浏览器未允许复制图片，请使用下载 PNG';
  }
};
