/*
    This Less plugin will search for CSS hex color variables and create a new variable which gives R,G,B values.
	The new variable is postfixed with '-rgb'

	To use it import it in your color variable definition file with `@plugin 'color2rgb.js';`

	It is particulary usefull to define opacity. Example:
	  
	   @plugin 'color2rgb.js';

	   body {
			--my-color: #AABBCC;

			// plugin will add at post processing the new variable:
			// --my-color-rgb: 170,187,204;
	   }

	   .opacity {
		   background: rgba(var(--my-color-rgb), .5));
	   }

	FIXME: It probably breaks .map
 */
const { popGraphicsState } = require("pdf-lib-draw-svg");


function getColors2RgbProcessor(less) {
	function Colors2RgbProcessor(options) {
		this.options = options || {};
	}

	Colors2RgbProcessor.prototype = {
		hexToRgb: function (hex) {
			const regex = /([a-f\d])([a-f\d])([a-f\d])/gi;

			const matches = [];
			while ((m = regex.exec(hex)) !== null) {
				matches.push(m);
			}

			let rgb;
			switch (matches.length) {
				case 1:
					rgb = matches[0].slice(1).map(_ => _ + _);
					break;
				case 2:
					rgb = new Array(3);
					x = matches.map(_ => _.slice(1)).flat();
					for (let i = 0; i < 6; i += 2) {
						rgb[i/2] = x[i] + x[i + 1];
					}
					break;
				default:
					return null;
			}
			return  rgb.map(x => parseInt(x, 16));
		},
		process: function (css, extra) {
			let newCss = '';
			for (let line of css.split('\n')) {

				if (line.trim().startsWith('--')) {
					let [prop, value] = line.split(':');

					if (!value?.trim().startsWith('#')) {
						// if variable is not an hex color copy as is and continue
						newCss += line + '\n';
						continue;
					}

					rgb = this.hexToRgb(value);
					newCss += line + '\n';
					newCss += `${prop}-rgb: ${rgb};\n`;

				} else {
					newCss += line + '\n';
				}
			}

			return newCss;
		}
	}

	return Colors2RgbProcessor;
}

registerPlugin({
	install: function (less, pluginManager, functions) {
		const Colors2RgbProcessor = getColors2RgbProcessor(less);
		pluginManager.addPostProcessor(new Colors2RgbProcessor(this.options));
	}
})

