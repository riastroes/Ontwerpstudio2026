// Hoofdmodule: importeer en start alles
// Initialiseer alleen de juiste controllers uit menu.js
import { PatternPickerController, MenuController } from '../menu.js';


// Start PatternPickerController en MenuController, verbind menu-interactie
if (typeof window !== 'undefined') {
	if (!window.Ontwerpstudio2026) window.Ontwerpstudio2026 = {};
	if (!window.Ontwerpstudio2026.patternPickerController) {
		const patternPicker = new PatternPickerController();
		patternPicker.init();
		window.Ontwerpstudio2026.patternPickerController = patternPicker;
		// MenuController koppelen aan PatternPickerController
		new MenuController({
			onRightViewSelect: (view) => patternPicker.setRightView(view)
		});
	}
}
