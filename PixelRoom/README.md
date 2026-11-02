# Pixelroom

A small image editor that runs in your browser. The server only serves static files; images, fonts, OCR, subject selection, reconstruction, masks, and project files are handled on the device. No backend, account, external API, CDN, or third-party runtime connection is required. The bundled model files are loaded from the same server as the app.

## Install on a Linux server

PixelRoom is a static website: no Node.js, database, build step, API key, or network connection to an external service is needed to run it. You need Git to obtain this repository and a static web server to serve it. Visitors need a current browser with WebAssembly SIMD and Web Workers. Keep the entire `dist/` directory, including `vendor/ocr` and `vendor/vision`: these contain the local OCR and image-processing models.

### Quick test

On the Linux server, clone the repository using an account authorized to access it, then start a temporary server:

```sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite/PixelRoom
python3 -m http.server 8080 --bind 0.0.0.0 --directory dist
```

Visit `http://SERVER_IP:8080/` from a device that can reach the server. Replace `SERVER_IP` with the server's IP address or hostname. Stop the test server with `Ctrl+C`. Python's simple server is intended for testing, not as a long-running production server.

### Serve with Nginx

For an ongoing installation, the following example uses Nginx on port `8080`. On Debian or Ubuntu, install it with `sudo apt install nginx git`, then clone the repository as shown above. From inside `RoomSuite/PixelRoom`:

```sh
sudo mkdir -p /srv/pixelsuite/PixelRoom
sudo cp -a dist /srv/pixelsuite/PixelRoom/
```

Create `/etc/nginx/sites-available/pixelroom` with this configuration:

```nginx
server {
    listen 8080;
    server_name _;
    root /srv/pixelsuite/PixelRoom/dist;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Enable the site, check the configuration, and reload Nginx:

```sh
sudo ln -s /etc/nginx/sites-available/pixelroom /etc/nginx/sites-enabled/pixelroom
sudo nginx -t
sudo systemctl reload nginx
```

Open `http://SERVER_IP:8080/`. Choose an unused port if `8080` is already in use, and allow the port through your server's firewall if needed. For a publicly reachable installation, configure access control and HTTPS in Nginx or your existing reverse proxy. When updating, pull the repository and replace the installed `dist/` with the updated copy, then reload the browser.

## Editing

- **Bring in a photo** opens an image as a new canvas. The plus button in Layers adds another image to the current canvas. Drag layers to move them; use the lower-right handle to resize.
- Edit brightness, contrast, and saturation; crop; add text and shapes; rotate and flip images; reorder, hide, duplicate, and delete layers.
- Select an image layer and open **Advanced color** for exposure, white balance, tonal controls and vibrance. **Creative grading** adds curves, HSL, tonal color wheels, 3D `.cube` LUTs, grain, vignette and sharpening. **Looks & presets** saves or imports portable `.roomgrade` looks; strength, bypass and before/after comparison are available. The source stays unchanged. See [shared color and portable looks](../COLOR_GRADING.md) for formats, supported LUTs and limitations.
- Import local TTF, OTF, WOFF, or WOFF2 fonts from Text or a selected text layer. Adjust font size, spacing, alignment, and style. Imported fonts are embedded in saved `.pixelroom` projects.
- Shapes include rectangles, ellipses, lines, polygons, and stars. The selected shape's properties include angle, corner roundness, fill, outline, and, where relevant, sides or points and star depth.
- **Export** saves a PNG, JPEG, or WebP image. **Save project** creates an editable `.pixelroom` file; use **Open project** to resume it. Work is not automatically saved when the page closes.
- On a phone, the bottom bar provides the editing tools. Open **Layers** to edit the selected layer's settings.

## Background and text isolation

Select an image layer, then use **Remove background** to suggest a foreground subject with the bundled local U²-Net model. Adjust the subject edge and use Remove brush or Keep brush before applying. For a landscape or another image without a clear subject, choose **Start with background color**, then tap colors to remove. The applied cutout is an editable mask: the original image pixels stay in the project. Select the layer and choose **Edit background cutout** to refine it again, or **Remove saved cutout** to reveal the source. Undo and redo also restore mask changes. Cancel discards the preview.

You can import a PNG mask using its alpha channel (opaque removes) or brightness (white removes). It must match the image aspect ratio within 1%, fit within 2,048 pixels per side and 4 megapixels, and be at most 16 MiB. Masks are resampled to the image layer for rendering. For lower memory use, the cutout editor prepares at most 2,048 pixels per side and 4 megapixels, or 1,024 pixels per side and 1 megapixel on small/low-memory devices; fine edges can therefore be softened. Masked projects use `.pixelroom` version 2, which older PixelRoom versions cannot open; unmasked projects remain version 1.

For local color adjustments, select an image layer and choose **Paint color region** or **Import color region PNG**. Purple shows the selected area; the layer’s current color controls apply only inside it, with partial mask opacity producing a gradual blend. Edit the region again or choose **Apply color to whole layer** to remove it. Cutout and color-region masks can be used together. The color region stays with the project and is not included in a portable `.roomgrade` preset.

**Find text areas** first lists editable text layers, then detects high-contrast lettering or uses the selected local English, French, Spanish or Italian OCR model on image pixels. Choose a suggestion or draw a selection. The purple preview shows the letter mask; **Show letters only** makes stray background pixels easier to see. Adjust tolerance or use the brushes to refine the mask. If **Rebuild the background** is selected, **Preview cleanup** runs the local LaMa model and shows the reconstructed area before **Apply isolation**. Go back to refine the selection or cancel if the result is not suitable. Unchecking background rebuilding leaves the original letters in the image.

Review the locally recognized words and correct them if necessary. **Create editable text** adds a text layer with **Original lettering** selected: it retains the selected letter shapes and color from the image, and lets you rearrange recognized characters, recolor or resize them, or choose a different font. The selected shapes are saved in the `.pixelroom` project. Edited text scales proportionally to fit the original width by default; turn off **Fit edits to original width** in Layers to let it grow. Only pixels included in the refined mask are retained; an outline or effect outside the mask is not included.

Layer IDs are retained when a valid project is reopened and saved, so an agent can target the same layer with the current file revision. Missing or duplicate legacy IDs receive new unique IDs. MCP can inspect, add and edit layers, convert an already-isolated transparent image layer, or select a rectangular region of an ordinary unrotated image and create original lettering in a separate project copy. The region action uses the same automatic letter-color mask and OCR as the editor; an agent can provide a letter-color sample and tolerance, preview the result, and optionally run local background rebuilding. The agent action does not expose the editor's manual mask brushes, so review or refine difficult selections in the editor. Apply or remove editable masks first; image color adjustments are not transferred to the resulting text layer.

An image does not contain the complete original font. Characters that were not recognized in the selection use a locally matched substitute, and the editor identifies them in the layer settings. Import the original font file for an exact match across the whole alphabet. Choose the text language before scanning, or change it in the conversion dialog and select **Read again**. OCR is approximate, so obscured or unusual lettering may need correction. To convert an isolated image layer from an older project, select it and choose **Convert isolated text**. The previous image layer can be recovered with Undo.

The subject model and WebAssembly runtime load from the same server on first use (about 20 MB together); the background-reconstruction model adds about 62 MB on its first use. They run on the device and can take time or exceed memory on older phones. Models are kept in memory for the current session and browser caching depends on server settings.
Subject detection, recognition, masks, and background reconstruction are approximate. White letters on white snow, occluded lettering, textured backgrounds, and other ambiguous images can require manual cleanup; obscured pixels cannot be recovered. A flattened image cannot reveal original PSD or XCF layers. Image import depends on browser decoders; common PNG, JPEG, WebP, GIF (first frame), BMP, and SVG files generally work, while HEIC, AVIF, and other support varies. Large images depend on available device memory and canvas limits.

## Included model components

`dist/vendor/ocr` contains Tesseract.js 7 and Tesseract.js-core 7 (Apache 2.0; license included) and English, French, Spanish and Italian trained-data models. The three additional models come from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) under Apache 2.0; the included notice records the pinned source and checksums. They add about 3.0 MiB compressed and are loaded one language at a time only when needed. The engine and models run locally and are not sent to an OCR service.

`dist/vendor/vision` contains ONNX Runtime Web, the U²-Net portable subject model, and a quantized LaMa inpainting model. Their licenses, attribution, source links, and checksums are included in that directory. The LaMa model is split across four local files; keep all four.
