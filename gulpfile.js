const { Transform } = require('stream')
const { join, basename, relative, dirname } = require('path')
const { series, src, dest, parallel, symlink } = require('gulp')
const del = require('del')
const Vinyl = require('vinyl')
const cheerio = require('cheerio')
const cssnano = require('gulp-cssnano')
const { minify } = require('html-minifier')
const terser = require('terser')
const { isWebUri } = require('valid-url')

function cleanup() {
  return del('dist')
}

const css = ['css/normalize.css', 'css/webflow.css', 'css/jraft-landing.webflow.css']
const js = ['js/webflow.js']

function concat(name) {
  let meta = null
  let buffers = []
  return new Transform({
    objectMode: true,
    transform(file, _enc, cb) {
      buffers.push(file.contents)
      buffers.push(Buffer.from('\n'))
      if (!meta) {
        meta = {
          cwd: file.cwd,
          base: file.base,
        }
      }
      cb()
    },
    flush(cb) {
      const file = new Vinyl({
        ...meta,
        path: join(meta.base, name),
        contents: Buffer.concat(buffers),
      })
      cb(null, file)
    },
  })
}

function minifyJs() {
  return new Transform({
    objectMode: true,
    async transform(file, _enc, cb) {
      const content = file.contents.toString()
      const res = await terser.minify(content)
      file.contents = Buffer.from(res.code)
      cb(null, file)
    },
  })
}

function buildStyles() {
  return src(css).pipe(concat('style.css')).pipe(cssnano()).pipe(dest('dist/css'))
}

function buildJs() {
  return src('./js/webflow.js').pipe(minifyJs()).pipe(dest('dist/js'))
}

function link() {
  return src(['fonts', 'images', 'videos']).pipe(symlink('dist', { dirMode: true, relativeSymlinks: true }))
}

function build() {
  return src(['**/*.html', '!dist', '!.yarn'])
    .pipe(
      new Transform({
        objectMode: true,
        transform(file, _enc, cb) {
          const $ = cheerio.load(file.contents)
          try {
            verifyCSS($)
            verifyJS($)
          } catch (err) {
            return cb(err)
          }
          $('script[src]').attr('defer', true)
          $('link[rel=stylesheet]')
            .filter((_, el) => !isWebUri(el.attribs.href))
            .remove()
          const prefix = relative(dirname(file.path), file.base)
          $('head').append(`<link rel="stylesheet" href="${prefix}/css/style.css">`)

          file.contents = Buffer.from(
            minify($.html(), {
              collapseBooleanAttributes: true,
              collapseWhitespace: true,
              conservativeCollapse: true,
              minifyCSS: true,
              minifyJS: true,
            })
          )
          cb(null, file)
        },
      })
    )
    .pipe(dest('dist'))
}

exports.default = series(cleanup, build, parallel(link, buildStyles, buildJs))

function verifyCSS($) {
  const paths = new Set(
    $('link[rel=stylesheet]')
      .toArray()
      .map(({ attribs: { href } }) => href)
      .filter((path) => path != null && !isWebUri(path))
      .map((p) => basename(p))
  )
  const cssSet = new Set(css.map((p) => basename(p)))
  if (!Array.from(paths).every((path) => cssSet.has(path))) {
    throw new Error(`not all css include ${JSON.stringify([...paths])}`)
  }
}

function verifyJS($) {
  const paths = new Set(
    $('script[src]')
      .toArray()
      .map(({ attribs: { src } }) => src)
      .filter((path) => path != null && !isWebUri(path))
      .map((p) => basename(p))
  )
  const jsSet = new Set(js.map((p) => basename(p)))
  if (!Array.from(paths).every((path) => jsSet.has(path))) {
    throw new Error(`not all js include ${JSON.stringify([...paths])}`)
  }
}
