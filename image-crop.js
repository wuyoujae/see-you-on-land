(() => {
  "use strict";
  window.cropSolverImage = (dataUrl) => new Promise(resolve => {
    if (!window.Cropper) { resolve(dataUrl); return; }
    const dialog = document.createElement("dialog");
    dialog.className = "solver-crop-dialog";
    dialog.setAttribute("aria-labelledby", "solver-crop-title");
    dialog.innerHTML = `<header><h2 id="solver-crop-title">裁剪题目</h2><button type="button" data-action="cancel" aria-label="取消裁剪" title="取消裁剪"><i data-lucide="x"></i></button></header>
      <div class="solver-crop-stage"><img alt="待裁剪的题目"></div>
      <div class="solver-crop-tools">
        <button type="button" data-action="zoom-in" aria-label="放大" title="放大"><i data-lucide="zoom-in"></i></button>
        <button type="button" data-action="zoom-out" aria-label="缩小" title="缩小"><i data-lucide="zoom-out"></i></button>
        <button type="button" data-action="rotate" aria-label="旋转" title="旋转"><i data-lucide="rotate-cw"></i></button>
        <button type="button" data-action="reset" aria-label="重置裁剪" title="重置裁剪"><i data-lucide="undo-2"></i></button>
      </div><p class="solver-crop-error" role="status"></p>
      <footer><button type="button" data-action="original">使用原图</button><button type="button" data-action="confirm" disabled>确认裁剪</button></footer>`;
    document.body.append(dialog);
    const previousFocus = document.activeElement;
    const image = dialog.querySelector("img");
    const confirm = dialog.querySelector('[data-action="confirm"]');
    const error = dialog.querySelector('.solver-crop-error');
    let cropper;
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      cropper?.destroy();
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      resolve(value);
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("click", event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === "cancel") finish(null);
      if (action === "original") finish(dataUrl);
      if (action === "reset") cropper?.reset();
      if (action === "rotate") cropper?.rotate(90);
      if (action === "zoom-in") cropper?.zoom(0.1);
      if (action === "zoom-out") cropper?.zoom(-0.1);
      if (action === "confirm" && cropper) {
        try {
          const canvas = cropper.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400, fillColor: '#fff', imageSmoothingQuality: 'high' });
          if (!canvas?.width || !canvas.height) throw new Error('请选择有效的裁剪区域。');
          const result = canvas.toDataURL('image/jpeg', 0.95);
          if (!result.startsWith('data:image/')) throw new Error('裁剪失败，请缩小图片后重试。');
          finish(result);
        } catch (err) { error.textContent = err.message || '裁剪失败，请重试或使用原图。'; }
      }
    });
    image.onerror = () => { error.textContent = '图片无法加载，请取消后重新上传。'; };
    image.onload = () => {
      if (finished || cropper) return;
      cropper = new Cropper(image, {
        viewMode: 1, autoCropArea: 0.9, dragMode: 'move', background: false,
        ready() { confirm.disabled = false; },
      });
    };
    dialog.showModal();
    window.lucide?.createIcons();
    image.src = dataUrl;
  });
})();
