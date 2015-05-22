var tap = require('gulp-tap');
var _ = require('lodash');
var chalk = require('chalk');
var gm = require('gm');

var fileActions = {
  '\\.(jpe?g|png)$': { 
    maxSize: 1000000,
    image: true,
    minWidth: 640,
    minHeight: 480,
    maxWidth: 2048,
    maxHeight: 1536,
  },
  '\\.svg$': { maxSize: 1000000 },
  '\\.(mp4|m4v|ogv)': { maxSize: 10000000 },
  '\\.(mp3|ogg|aac|m4a)': { maxSize: 2000000},
};

function warn(file, msg) {
  console.log(chalk.yellow('Warning: ') + msg);
  console.log(chalk.blue('In file: ') + file.path);
}

module.exports = function fileSizeChecker(lfa) {
  lfa.task('assets:pre-write:file-size-checker', function (stream) {
    if (lfa.currentCompile.debug) {
      return stream;
    }

    return stream
      .pipe(tap(function (file) {
        if (!file.stat.isFile()) { 
          return file;
        }

        var actions = lfa.config.package.fileSizeCheckerActions || fileActions;

        _.each(actions, function (options, regexp) {
          if (!new RegExp(regexp).test(file.path)) {
            return;
          }

          if (options.maxSize && file.stat.size >= options.maxSize) {
            warn(file, 'File size (' + file.stat.size + ') bigger than ' + options.maxSize);
          }

          if (options.image) {
            gm(file.history[0]).size(function (err, size) {
              if (err) {
                warn(file, 'Can\'t open image:\n' + err.message);
              } else {
                if ((options.maxWidth && size.width > options.maxWidth) ||
                    (options.maxHeight && size.height > options.maxHeight)) {
                  warn(file, 'Image dimensions too big: ' + size.width + 'x' + size.height + ' bigger than ' + options.maxWidth + 'x' + options.maxHeight);
                }
                if ((options.minWidth && size.width < options.minWidth) ||
                    (options.minHeight && size.height < options.minHeight)) {
                  warn(file, 'Image dimensions too small: ' + size.width + 'x' + size.height + ' smaller than ' + options.minWidth + 'x' + options.minHeight);
                }
              }
            });
          }
        });

        return file;
      }));
  });
};
