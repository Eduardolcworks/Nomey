<#
    Derives Nomey's platform icon assets from the two brand originals.

    The originals are the source of truth and are never edited. Everything this
    script produces is a mechanical derivation of them - crop, colour-key,
    scale, pad - so the mark's geometry is never redrawn or approximated. Rerun
    it whenever a brand original changes.

    Windows only: it uses System.Drawing, which avoids adding an image
    dependency to the project for a job that runs by hand a few times a year.

        powershell -ExecutionPolicy Bypass -File scripts/derive-brand-assets.ps1

    Outputs, all overwritten in place:

        assets/icons/icon.png                     iOS + top-level app icon
        assets/icons/android-icon-foreground.png  adaptive icon foreground
        assets/icons/android-icon-monochrome.png  Android 13+ themed icon
        assets/splash/splash-icon.png             splash mark
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'assets\icons'
$splash = Join-Path $root 'assets\splash'

# The two brand originals. The yellow ground is the primary variant.
$primary = Join-Path $icons 'nomey-logo-on-yellow.png'
$secondary = Join-Path $icons 'nomey-logo-on-black.png'

# Measured on the originals: the mark sits at luminance ~28 on the yellow
# variant and ~193 on the black one, with the grounds at 0 and 0-54. Nothing of
# substance lives between 80 and 150, so the ramp separates mark from ground
# without touching either.
$DARK = 110.0
# The crop border must be unambiguously ground, above the ramp rather than
# merely above the dark cut-off, or the artwork's darkened bevel survives the
# colour key as a faint opaque frame and widens the mark's bounding box.
$GROUND = 170.0
$RAMP_LO = 80.0
$RAMP_HI = 150.0

# Chroma ramp for the splash, on (R+G)/2 - B. The brand yellow reads ~223 and
# every neutral reads ~0, so the gap is far wider than the luminance one.
$CHROMA_LO = 60.0
$CHROMA_HI = 140.0

# Android masks an adaptive icon down to the inner 66 of 108 units. Keeping the
# mark within 0.60 of the canvas leaves it whole under every mask shape.
$SAFE_FRACTION = 0.60

# Nomey's brand yellow, the same value as `Colors.dark.accent` in
# src/ui/theme/colors.ts. The icon ground is flat brand yellow, not a sample of
# the artwork's gradient, so the icon and the accent inside the app are the
# same colour rather than two yellows that nearly match.
$GROUND_ARGB = [Convert]::ToInt32('FFFDC506', 16)

$csharp = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Brand
{
    static int[] Read(Bitmap bm)
    {
        var d = bm.LockBits(new Rectangle(0, 0, bm.Width, bm.Height),
                            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int[] px = new int[bm.Width * bm.Height];
        Marshal.Copy(d.Scan0, px, 0, px.Length);
        bm.UnlockBits(d);
        return px;
    }

    static Bitmap Write(int[] px, int w, int h)
    {
        var bm = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var d = bm.LockBits(new Rectangle(0, 0, w, h),
                            ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(px, 0, d.Scan0, px.Length);
        bm.UnlockBits(d);
        return bm;
    }

    static double Lum(int p)
    {
        return 0.2126 * ((p >> 16) & 0xFF) + 0.7152 * ((p >> 8) & 0xFF) + 0.0722 * (p & 0xFF);
    }

    // Bounding box of everything brighter than the threshold: on the primary
    // variant that is the artwork's rounded square, floating on a black margin.
    public static Rectangle BrightBounds(Bitmap src, double thr)
    {
        int w = src.Width, h = src.Height;
        int[] px = Read(src);
        int x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (int i = 0; i < px.Length; i++)
        {
            if (Lum(px[i]) <= thr) continue;
            int x = i % w, y = i / w;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        }
        if (x1 < 0) throw new Exception("no bright pixels found");
        return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }

    // The largest rectangle inside `box`, inset equally on all four sides,
    // whose entire border is ground - that is, with the artwork's rounded
    // corners cut away.
    //
    // Both platforms mask a full-bleed square with their own shape, so what an
    // icon needs is ground all the way to the edge. Painting the corner cuts
    // instead was tried twice and failed the same way both times: the colour
    // available at the corner is the artwork's darkened bevel, so extending it
    // outward gives either radial streaks or muddy corners. Cropping inside
    // the bevel needs no invented pixels at all, and it is also what Apple
    // asks for - supply the square, let the system round it.
    public static Rectangle SolidInset(Bitmap src, Rectangle box, double thr)
    {
        int[] px = Read(src);
        int w = src.Width;
        int limit = Math.Min(box.Width, box.Height) / 2;

        for (int d = 0; d < limit; d++)
        {
            var r = new Rectangle(box.X + d, box.Y + d, box.Width - 2 * d, box.Height - 2 * d);
            bool solid = true;
            for (int x = r.Left; x < r.Right && solid; x++)
            {
                if (Lum(px[r.Top * w + x]) <= thr) solid = false;
                if (Lum(px[(r.Bottom - 1) * w + x]) <= thr) solid = false;
            }
            for (int y = r.Top; y < r.Bottom && solid; y++)
            {
                if (Lum(px[y * w + r.Left]) <= thr) solid = false;
                if (Lum(px[y * w + r.Right - 1]) <= thr) solid = false;
            }
            if (solid) return r;
        }
        throw new Exception("no solid inset found");
    }

    // Turns luminance into alpha over a soft ramp, so the antialiased edges of
    // the mark survive as partial alpha instead of becoming a jagged cut.
    // keepBright keeps the light mark, otherwise the dark one. forceRgb >= 0
    // replaces the colour, for the monochrome layer.
    public static Bitmap Key(Bitmap src, double lo, double hi, bool keepBright, int forceRgb)
    {
        int w = src.Width, h = src.Height;
        int[] px = Read(src);
        for (int i = 0; i < px.Length; i++)
        {
            double t = (Lum(px[i]) - lo) / (hi - lo);
            if (t < 0) t = 0; else if (t > 1) t = 1;
            if (!keepBright) t = 1 - t;
            int rgb = forceRgb >= 0 ? forceRgb : (px[i] & 0xFFFFFF);
            px[i] = ((int)Math.Round(t * 255) << 24) | rgb;
        }
        return Write(px, w, h);
    }

    // Keys on yellowness rather than brightness: (R+G)/2 - B, which is ~223 for
    // the brand yellow and ~0 for any neutral.
    //
    // The secondary variant is a glossy black square, and its specular
    // highlight is bright enough to survive a luminance key - it came through
    // as a ghosted outline of the square around the mark. The highlight is
    // neutral grey, so chroma separates what luminance could not.
    public static Bitmap KeyYellow(Bitmap src, double lo, double hi)
    {
        int w = src.Width, h = src.Height;
        int[] px = Read(src);
        for (int i = 0; i < px.Length; i++)
        {
            int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
            double t = ((r + g) / 2.0 - b - lo) / (hi - lo);
            if (t < 0) t = 0; else if (t > 1) t = 1;
            px[i] = ((int)Math.Round(t * 255) << 24) | (px[i] & 0xFFFFFF);
        }
        return Write(px, w, h);
    }

    // Bounding box of everything at least minAlpha opaque.
    public static Rectangle Bounds(Bitmap src, int minAlpha)
    {
        int w = src.Width, h = src.Height;
        int[] px = Read(src);
        int x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (int i = 0; i < px.Length; i++)
        {
            if (((px[i] >> 24) & 0xFF) < minAlpha) continue;
            int x = i % w, y = i / w;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        }
        if (x1 < 0) throw new Exception("no opaque pixels found");
        return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }

    // Centres a crop of the source on a square canvas, scaled so its longest
    // side takes `fraction` of the canvas. Aspect ratio is preserved, so the
    // mark is never stretched.
    public static Bitmap Place(Bitmap src, Rectangle crop, int size, double fraction, int bgArgb)
    {
        var canvas = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(canvas))
        {
            g.Clear(Color.FromArgb(bgArgb));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;

            double target = size * fraction;
            double scale = target / Math.Max(crop.Width, crop.Height);
            float dw = (float)(crop.Width * scale), dh = (float)(crop.Height * scale);
            g.DrawImage(src, new RectangleF((size - dw) / 2f, (size - dh) / 2f, dw, dh),
                        crop, GraphicsUnit.Pixel);
        }
        return canvas;
    }

    // Fills the canvas with the crop, ignoring aspect ratio differences by
    // scaling the longest side to cover. Used for the full-bleed app icon,
    // whose crop is already square to within a few pixels.
    public static Bitmap Fill(Bitmap src, Rectangle crop, int size)
    {
        var canvas = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(canvas))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, new RectangleF(0, 0, size, size), crop, GraphicsUnit.Pixel);
        }
        return canvas;
    }

    // Saves without an alpha channel. The App Store rejects an icon that has
    // one, and a transparent icon renders black on the home screen.
    public static void SaveOpaque(Bitmap src, string path)
    {
        using (var flat = new Bitmap(src.Width, src.Height, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(flat)) { g.DrawImage(src, 0, 0, src.Width, src.Height); }
            flat.Save(path, ImageFormat.Png);
        }
    }
}
'@

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $csharp

function Report($path) {
    $bm = New-Object System.Drawing.Bitmap $path
    $kb = [Math]::Round((Get-Item $path).Length / 1KB)
    $channel = if ("$($bm.PixelFormat)" -match 'Argb') { 'alpha ' } else { 'opaque' }
    Write-Output ("  {0,-30} {1}x{2}  {3}  {4} KB" -f (Split-Path $path -Leaf), $bm.Width, $bm.Height, $channel, $kb)
    $bm.Dispose()
}

Write-Output 'Deriving brand assets...'

# --- Extract the mark, pixel for pixel, from the primary variant -----------
#
# The original is a rendered 3D icon: a beveled rounded square, glossy, on a
# black margin. Two things make it unusable as an icon file directly.
#
# Its corners are rounded to about a third of its width, well beyond the ~22%
# superellipse iOS masks with, so shipping it full-bleed leaves the artwork's
# own corner cuts visible inside the system mask. And painting those cuts back
# in fails - the only colour available there is the darkened bevel, which
# extends outward as either radial streaks or muddy corners. Both were tried.
#
# Cropping inside the bevel instead avoids inventing pixels, but it magnifies
# the mark to 90% of the frame, where the mask clips it.
#
# So the icon is composed: the flat brand ground, and the mark lifted out of
# the original by colour key - never redrawn - at the same proportion of the
# square the designer framed it at. The gloss stays in the brand original,
# which is what it is for; the icon file gets what an icon file needs.
$src = New-Object System.Drawing.Bitmap $primary
$groundBox = [Brand]::BrightBounds($src, $DARK)
$solid = [Brand]::SolidInset($src, $groundBox, $GROUND)
$cropped = [Brand]::Fill($src, $solid, 1024)
$markOnly = [Brand]::Key($cropped, $RAMP_LO, $RAMP_HI, $false, -1)
$markBox = [Brand]::Bounds($markOnly, 128)

# The mark's share of the artwork's square, measured rather than chosen, so the
# icon reproduces the original framing instead of inventing one.
$markInOriginal = $markBox.Width * $solid.Width / 1024.0
$MARK_FRACTION = $markInOriginal / $groundBox.Width

Write-Output ("  ground {0}x{1}, solid crop {2}x{3} (inset {4} px), mark {5:P1} of the square" -f
    $groundBox.Width, $groundBox.Height, $solid.Width, $solid.Height, ($solid.X - $groundBox.X), $MARK_FRACTION)

# --- iOS / top-level app icon: flat brand ground, no alpha ------------------
$appIcon = [Brand]::Place($markOnly, $markBox, 1024, $MARK_FRACTION, $GROUND_ARGB)
[Brand]::SaveOpaque($appIcon, (Join-Path $icons 'icon.png'))

# --- Android adaptive foreground: the mark alone, inside the safe zone ------
#
# 1024 rather than the 512 it was first written at, which is a change of
# resolution and NOT of geometry: `Place` takes the same mark, the same
# bounding box and the same $SAFE_FRACTION, so the symbol keeps its share of
# the canvas and its centre and is simply rasterised onto a finer grid.
# `scripts/icon-geometry-check.mjs` is what holds that claim up.
#
# The reason to spend the pixels: the adaptive canvas is 432 px at xxxhdpi, but
# launchers, the app switcher and Play itself all scale a foreground up beyond
# that, and 512 leaves almost no headroom. 1024 is what Expo's own
# documentation asks for, and the file is consumed by the native build - it
# never enters the JavaScript bundle - so its weight costs no startup time.
$foreground = [Brand]::Place($markOnly, $markBox, 1024, $SAFE_FRACTION, 0)
$foreground.Save((Join-Path $icons 'android-icon-foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# --- Android monochrome: same silhouette, flattened to one colour -----------
$silhouette = [Brand]::Key($cropped, $RAMP_LO, $RAMP_HI, $false, 0)
$mono = [Brand]::Place($silhouette, $markBox, 432, $SAFE_FRACTION, 0)
$mono.Save((Join-Path $icons 'android-icon-monochrome.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# --- Splash: secondary variant, yellow mark on transparent ------------------
$dark = New-Object System.Drawing.Bitmap $secondary
$splashMark = [Brand]::KeyYellow($dark, $CHROMA_LO, $CHROMA_HI)
$splashBox = [Brand]::Bounds($splashMark, 128)
$splashOut = [Brand]::Place($splashMark, $splashBox, 512, 0.92, 0)
$splashOut.Save((Join-Path $splash 'splash-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($o in @($src, $appIcon, $cropped, $markOnly, $foreground, $silhouette, $mono, $dark, $splashMark, $splashOut)) {
    $o.Dispose()
}

Write-Output 'Done:'
Report (Join-Path $icons 'icon.png')
Report (Join-Path $icons 'android-icon-foreground.png')
Report (Join-Path $icons 'android-icon-monochrome.png')
Report (Join-Path $splash 'splash-icon.png')
