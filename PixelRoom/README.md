# Pixelroom

A small image editor that runs in your browser. The server only serves static files; images, fonts, OCR, subject selection, reconstruction, masks, and project files are handled on the device. No backend, account, external API, CDN, or third-party runtime connection is required. The bundled model files are loaded from the same server as the app.

## Install on a Linux server

PixelRoom is a static website: no Node.js, database, build step, API key, or network connection to an external service is needed to run it. You need Git to obtain this repository and a static web server to serve it. Visitors need a current browser with WebAssembly SIMD and Web Workers. Keep the entire `dist/` directory, including `vendor/ocr` and `vendor/vision`: these contain the local OCR and image-processing models.

### Quick test

On the Linux server, clone the repository using an account authorized to access it, then start a temporary server:

```sh
git clone https://github.com/ElHombreAlex/PixelSuite.git
cd PixelSuite/PixelRoom
python3 -m http.server 8080 --bind 0.0.0.0 --directory dist
```

Visit `http://SERVER_IP:8080/` from a device that can reach the server. Replace `SERVER_IP` with the server's IP address or hostname. Stop the test server with `Ctrl+C`. Python's simple server is intended for testing, not as a long-running production server.

### Serve with Nginx

For an ongoing installation, the following example uses Nginx on port `8080`. On Debian or Ubuntu, install it with `sudo apt install nginx git`, then clone the repository as shown above. From inside `PixelSuite/PixelRoom`:

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
- Import local TTF, OTF, WOFF, or WOFF2 fonts from Text or a selected text layer. Adjust font size, spacing, alignment, and style. Imported fonts are embedded in saved `.pixelroom` projects.
- Shapes include rectangles, ellipses, lines, polygons, and stars. The selected shape's properties include angle, corner roundness, fill, outline, and, where relevant, sides or points and star depth.
- **Export** saves a PNG, JPEG, or WebP image. **Save project** creates an editable `.pixelroom` file; use **Open project** to resume it. Work is not automatically saved when the page closes.
- On a phone, the bottom bar provides the editing tools. Open **Layers** to edit the selected layer's settings.

## Background and text isolation

**Remove background** first suggests a foreground subject using the bundled local U²-Net model. Adjust the subject edge and use Remove brush or Keep brush to refine the result before applying. For a landscape or another image without a clear subject, choose **Start with background color**, then tap colors to remove. Brush corrections are retained while sliders change. Cancel discards the preview.

**Find text areas** first lists editable text layers, then detects high-contrast lettering or uses bundled English OCR on image pixels. Choose a suggestion or draw a selection. The purple preview shows the letter mask; **Show letters only** makes stray background pixels easier to see. Adjust tolerance or use the brushes to refine the mask. If **Rebuild the background** is selected, **Preview cleanup** runs the local LaMa model and shows the reconstructed area before **Apply isolation**. Go back to refine the selection or cancel if the result is not suitable. Unchecking background rebuilding leaves the original letters in the image.

Review the locally recognized words and correct them if necessary. **Create editable text** adds a text layer with **Original lettering** selected: it retains the selected letter shapes and color from the image, and lets you rearrange recognized characters, recolor or resize them, or choose a different font. The selected shapes are saved in the `.pixelroom` project. Edited text scales proportionally to fit the original width by default; turn off **Fit edits to original width** in Layers to let it grow. Only pixels included in the refined mask are retained; an outline or effect outside the mask is not included.

An image does not contain the complete original font. Characters that were not recognized in the selection use a locally matched substitute, and the editor identifies them in the layer settings. Import the original font file for an exact match across the whole alphabet. OCR uses the bundled English model, so obscured or unusual lettering may need correction. To convert an isolated image layer from an older project, select it and choose **Convert isolated text**. The previous image layer can be recovered with Undo.

The subject model and WebAssembly runtime load from the same server on first use (about 20 MB together); the background-reconstruction model adds about 62 MB on its first use. They run on the device and can take time or exceed memory on older phones. Models are kept in memory for the current session and browser caching depends on server settings.
Subject detection, recognition, masks, and background reconstruction are approximate. White letters on white snow, occluded lettering, textured backgrounds, and other ambiguous images can require manual cleanup; obscured pixels cannot be recovered. A flattened image cannot reveal original PSD or XCF layers. Image import depends on browser decoders; common PNG, JPEG, WebP, GIF (first frame), BMP, and SVG files generally work, while HEIC, AVIF, and other support varies. Large images depend on available device memory and canvas limits.

## Included model components

`dist/vendor/ocr` contains Tesseract.js 7 and Tesseract.js-core 7 (Apache 2.0; license included) and an English trained-data package. The engine and model are used locally and are not sent to an OCR service.

`dist/vendor/vision` contains ONNX Runtime Web, the U²-Net portable subject model, and a quantized LaMa inpainting model. Their licenses, attribution, source links, and checksums are included in that directory. The LaMa model is split across four local files; keep all four.

