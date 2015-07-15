var tap = require('gulp-tap');
var _ = require('lodash');
var chalk = require('chalk');
var gm = require('gm');
var when = require('when');
var nodefn = require('when/node');
var path = require('path');
var fs = require('fs');

var fileActions = {
  '\\.(jpe?g|png)$': { 
    maxSize: 1000000,
    image: true,
    maxWidth: 2048,
    maxHeight: 1536,
  },
  '\\.svg$': { maxSize: 1000000 },
  '\\.(mp4|m4v|ogv)': { maxSize: 10000000 },
  '\\.(mp3|ogg|aac|m4a)': { maxSize: 2000000},
  '.*' : { fileNames: true }
};

function parseNumber(str) {
  try {
    return parseFloat(str.match(/\((.*)\)/)[1]);
  } catch (ex) {
    return NaN;
  }
}


module.exports = function fileSizeChecker(lfa) {
  function warn(file, msg) {
    var err = new Error(msg);
    err.fileName = file.history[0];
    err.nameLess = true;
    lfa.logWarning(err);
  }

  var fixes = [];

  var videoRegexp = /^video\/(.*)\.(mp4|webm|ogv)$/;
  var audioRegexp = /^audio\/(.*)\.(mp3|ogg)$/;

  function renameAsset(assetsPath, from, to) {
    var relativeFromPath = path.relative(assetsPath, from);
    var relativeToPath = path.relative(assetsPath, to);

    var escapedRelativeFromPath = relativeFromPath.replace(/(\/|\.)/g, '\\\\$1');
    var escapedRelativeToPath = relativeToPath.replace(/(\/)/g, '\\\\$1');

    var textPath = path.join(lfa.config.projectPath, 'text');
    var stylesPath = path.join(lfa.config.projectPath, 'styles');
    var jsPath = path.join(lfa.config.projectPath, 'js');

    fixes.push('find "' + textPath + '" -type f \\( -name "*.jade" \\) -exec sed -i "" "s/' + escapedRelativeFromPath + '/' + escapedRelativeToPath + '/g" {} \\;');
    fixes.push('find "' + stylesPath + '" -type f \\( -name "*.styl" -or -name "*.css" \\) -exec sed -i "" "s/' + escapedRelativeFromPath + '/' + escapedRelativeToPath + '/g" {} \\;');
    fixes.push('find "' + jsPath + '" -type f \\( -name "*.js" -or -name "*.jsx" -or -name "*.json" \\) -exec sed -i "" "s/' + escapedRelativeFromPath + '/' + escapedRelativeToPath + '/g" {} \\;');

    _.each([videoRegexp, audioRegexp], function (regexp) {
      var match = relativeFromPath.match(regexp);
      if (match) {
        var relativeFromPath_ = match[1];
        var relativeToPath_ = relativeToPath.match(regexp)[1];
        var escapedRelativeFromPath_ = relativeFromPath_.replace(/(\/|\.)/g, '\\\\$1');
        var escapedRelativeToPath_ = relativeToPath_.replace(/(\/)/g, '\\\\$1');
        fixes.push('find "' + textPath + '" -type f \\( -name "*.jade" \\) -exec sed -i "" "s/' + escapedRelativeFromPath_ + '/' + escapedRelativeToPath_ + '/g" {} \\;');
      }
    });
  }

  function applyFix(file, fix) {
    if (!fix) { return; }

    var fileName = file.history[0];
    var assetsPath = path.join(lfa.config.projectPath, 'assets');
    if (fileName.indexOf(assetsPath) !== 0) { return; }

    if (fix === 'pngcrush') {
      fixes.push('pngcrush -rem gAMA -rem cHRM -rem iCCP -rem sRGB "' + fileName + '" "' + fileName + '.crushed.png"');
      fixes.push('mv "' + fileName + '.crushed.png" "' + fileName + '"');
      return;
    }

    if (fix === 'tojpg') {
      var jpegPath = fileName.replace(/\.png$/, '.jpg');
      fixes.push('gm convert "' + fileName + '" "' + jpegPath + '"');
      fixes.push('rm "' + fileName + '"');
      renameAsset(assetsPath, fileName, jpegPath);
      return;
    }

    if (fix === 'rename') {
      var relative = path.relative(assetsPath, fileName);
      var newRelative = relative.replace(/ /g, '_').toLowerCase();
      var newName = path.resolve(assetsPath, newRelative);

      if (path.dirname(fileName) !== path.dirname(newName)) {
        fixes.push('mkdir -p "' + path.dirname(newName) + '"');
      }
      fixes.push('mv "' + fileName + '" "' + newName + '"');

      renameAsset(assetsPath, fileName, newName);
      return;
    }
  }

  lfa.task('assets:pre-write:file-size-checker', function (stream) {
    if (lfa.currentCompile.debug) {
      return stream;
    }

    var assetsPath = path.join(lfa.config.projectPath, 'assets');
    var promises = [];

    var returnStream = stream.pipe(tap(function (file) {
      if (!file.stat.isFile()) { 
        return file;
      }

      var actions = lfa.config.package.fileSizeCheckerActions || fileActions;

      promises = promises.concat(_.map(actions, function (options, regexp) {
        if (!new RegExp(regexp).test(file.path)) {
          return;
        }

        var fix = null;
        var tooBig = false;

        if (options.maxSize && file.stat.size >= options.maxSize) {
          tooBig = true;
          warn(file, 'File size (' + file.stat.size + ') bigger than ' + options.maxSize);
        }

        if (options.fileNames && /[ A-Z]/.test(path.relative(assetsPath, file.history[0]))) {
          warn(file, 'Spaces or upper-case letters in file name');
          fix = 'rename';
        }

        return when.try(function () {
          if (!options.image) { return; }

          var image = gm(file.history[0]);

          return nodefn.call(image.identify.bind(image))
            .then(function (data) {
              if (tooBig && data.format === 'PNG') {
                fix = 'pngcrush';
              }

              var size = data.size;
              if ((options.maxWidth && size.width > options.maxWidth) ||
                  (options.maxHeight && size.height > options.maxHeight)) {
                warn(file, 'Image dimensions too big: ' + size.width + 'x' + size.height + ' bigger than ' + options.maxWidth + 'x' + options.maxHeight);
              }

              if ((options.minWidth && size.width < options.minWidth) ||
                  (options.minHeight && size.height < options.minHeight)) {
                warn(file, 'Image dimensions too small: ' + size.width + 'x' + size.height + ' smaller than ' + options.minWidth + 'x' + options.minHeight);
              }

              var chStats = data['Channel Statistics'] || {};
              if (data.format === 'PNG' && (!chStats.Opacity || parseNumber(chStats.Opacity.Minimum) === 1)) {
                fix = 'tojpg';
                warn(file, 'Opaque image saved as PNG');
              }
            })
            .catch(function (err) {
              warn(file, 'Can\'t open image:\n' + err.message);
            });
        }).then(function () {
          applyFix(file, fix);
        });
      }));

      return file;
    }));

    returnStream.on('end', function () {
      when.all(promises).then(function () {
        if (fixes.length) {
          lfa.logWarning('Saving a script with potential fixes in .lfa/build/fix.sh');
          fixes.splice(0, 0, '#!/bin/bash');
          var data = fixes.join('\n');
          fs.writeFile(path.join(lfa.config.projectPath, '.lfa' ,'build', 'fix.sh'), data);
        }
      });
    });

    return returnStream;
  });

};
