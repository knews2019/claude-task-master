import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// --- Mock Core Modules & Functions ---
const MOCK_PROJECT_ROOT = '/test-project';
const mockLog = jest.fn();
const mockFindProjectRoot = jest.fn(() => MOCK_PROJECT_ROOT);
const mockGenerateTextService = jest.fn();
const mockDisplayComplexityReport = jest.fn();
const mockListTasks = jest.fn();
const mockDisplayNextTask = jest.fn();
const mockDisplayTaskById = jest.fn();

const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();

const mockDefaultSubtasks = 5; // Default for expand when no report

// --- Mocking `fs` and `path` ---
// We'll spy on actual fs methods after mocking them for granular control
let fsExistsSyncSpy, fsReadFileSyncSpy, fsWriteFileSyncSpy, fsMkdirSyncSpy;
let pathResolveSpy;

jest.mock('fs', () => ({
	...jest.requireActual('fs'), // Import actual 'fs' for non-mocked methods if any
	existsSync: jest.fn(),
	readFileSync: jest.fn(),
	writeFileSync: jest.fn(),
	mkdirSync: jest.fn(),
}));

jest.mock('path', () => {
	const originalPath = jest.requireActual('path');
	return {
		...originalPath,
		resolve: jest.fn((...args) => originalPath.resolve(...args)), // Spy on resolve
	};
});


// --- Mock `utils.js` ---
jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	findProjectRoot: mockFindProjectRoot,
	log: mockLog,
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	isSilentMode: jest.fn(() => false),
	enableSilentMode: jest.fn(),
	disableSilentMode: jest.fn(),
	// findComplexityReport will be tested via its usage in commands
	findComplexityReport: jest.requireActual('../../../scripts/modules/utils.js').findComplexityReport, 
}));

// --- Mock `config-manager.js` ---
jest.unstable_mockModule('../../../scripts/modules/config-manager.js', () => ({
	getConfig: jest.fn(() => ({
		global: { defaultSubtasks: mockDefaultSubtasks, debug: false },
		paths: {}, // Default: no paths configured
	})),
	getComplexityReportConfigPath: jest.fn(() => null), // Default: no configured path
	getDefaultSubtasks: jest.fn(() => mockDefaultSubtasks),
	getDebugFlag: jest.fn(() => false),
	getProjectName: jest.fn(() => 'Test Project'),
}));

// --- Mock `ai-services-unified.js` ---
jest.unstable_mockModule('../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: mockGenerateTextService,
}));

// --- Mock `ui.js` ---
jest.unstable_mockModule('../../../scripts/modules/ui.js', () => ({
	displayComplexityReport: mockDisplayComplexityReport,
	listTasks: mockListTasks,
	displayNextTask: mockDisplayNextTask,
	displayTaskById: mockDisplayTaskById,
	startLoadingIndicator: jest.fn(() => ({ stop: jest.fn() })),
	stopLoadingIndicator: jest.fn(),
	log: mockLog, // Ensure log is also mocked here if commands.js imports it from ui
}));


// --- Dynamically import command actions AFTER mocks ---
let analyzeComplexityAction;
let expandAction;
// We need to get the actual command actions from program, which is tricky.
// For this test, we'll assume we can get the action functions.
// A more robust way would be to refactor commands.js to export actions or use child_process.

beforeAll(async () => {
	// Spy on the mocked fs and path methods
	fsExistsSyncSpy = jest.spyOn(fs, 'existsSync');
	fsReadFileSyncSpy = jest.spyOn(fs, 'readFileSync');
	fsWriteFileSyncSpy = jest.spyOn(fs, 'writeFileSync');
	fsMkdirSyncSpy = jest.spyOn(fs, 'mkdirSync');
	pathResolveSpy = jest.spyOn(path, 'resolve');
	
	// This is a simplified way to get the actions. In a real test setup,
	// you might need to parse `program` from `commands.js` or refactor `commands.js`
	// to export the actions for easier testing.
	const commandsModule = await import('../../../scripts/modules/commands.js');
	const program = commandsModule.setupCLI(); // setupCLI registers commands

	analyzeComplexityAction = program.commands.find(c => c.name() === 'analyze-complexity')._actionHandler;
	expandAction = program.commands.find(c => c.name() === 'expand')._actionHandler;
});

beforeEach(() => {
	jest.clearAllMocks();

	// Default mock implementations
	mockFindProjectRoot.mockReturnValue(MOCK_PROJECT_ROOT);
	fsExistsSyncSpy.mockImplementation((filePath) => {
		// console.log(`FS.EXISTS: ${filePath}`); // Debugging
		if (filePath.endsWith('.taskmasterconfig')) return false; // No config file by default
		if (filePath.endsWith('tasks.json')) return true; // Assume tasks.json exists
		return false; // Default to file not existing
	});
	fsReadFileSyncSpy.mockImplementation((filePath) => {
		// console.log(`FS.READ: ${filePath}`); // Debugging
		if (filePath.endsWith('tasks.json')) return JSON.stringify({ tasks: [{ id: 1, title: "Test Task 1" }] });
		throw new Error(`fs.readFileSync mock: Unhandled path ${filePath}`);
	});
	fsWriteFileSyncSpy.mockImplementation((filePath, data) => {
		// console.log(`FS.WRITE: ${filePath}`, data); // Debugging
	});
	fsMkdirSyncSpy.mockImplementation(() => {});

	// Reset path.resolve spy to default behavior but keep it as a spy
	pathResolveSpy.mockImplementation((...args) => jest.requireActual('path').resolve(...args));


	// Mock AI service for expand
	mockGenerateTextService.mockResolvedValue({
		mainResult: JSON.stringify({
			subtasks: Array.from({ length: mockDefaultSubtasks }, (_, i) => ({
				id: i + 1,
				title: `Subtask ${i + 1}`,
				description: `Description for subtask ${i + 1}`,
				dependencies: [],
				details: 'Details...',
				status: 'pending'
			}))
		}),
		telemetryData: { /* ... */ }
	});
});

afterAll(() => {
	jest.restoreAllMocks();
});

describe('CLI Path Resolution Integration Tests', () => {
	describe('analyze-complexity command (output path)', () => {
		const initialTasks = { tasks: [{ id: 1, title: "Analyze Me" }] };

		test('Scenario 1.1: No --output flag, generates report in scripts/', async () => {
			fsReadFileSyncSpy.mockImplementation(filePath => { // Override for this test
				if (filePath.endsWith('tasks.json')) return JSON.stringify(initialTasks);
				return '';
			});
			fsExistsSyncSpy.mockImplementation(p => p.endsWith('tasks.json')); // Only tasks.json exists initially

			const options = { file: 'tasks/tasks.json' }; // No output flag
			await analyzeComplexityAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });
			
			const expectedReportPath = path.join(MOCK_PROJECT_ROOT, 'scripts/task-complexity-report.json');
			expect(fsWriteFileSyncSpy).toHaveBeenCalledWith(expectedReportPath, expect.any(String));
		});

		test('Scenario 1.2: --output flag used, generates report at custom path', async () => {
			fsReadFileSyncSpy.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return JSON.stringify(initialTasks);
				return '';
			});
			fsExistsSyncSpy.mockImplementation(p => p.endsWith('tasks.json'));

			const customOutputPath = 'custom/out/custom-report.json';
			const options = { file: 'tasks/tasks.json', output: customOutputPath };
			await analyzeComplexityAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });
			
			// path.resolve for options.output will be called from CWD, so we expect MOCK_PROJECT_ROOT to be part of it.
			// The analyzeTaskComplexity function itself resolves options.output relative to establishedProjectRoot if not absolute.
			// For this test, we assume customOutputPath is relative to MOCK_PROJECT_ROOT.
			const expectedReportPath = path.join(MOCK_PROJECT_ROOT, customOutputPath);
			// Let's refine the expectation to be relative to the MOCK_PROJECT_ROOT if options.output is not absolute
			const resolvedCustomPath = path.resolve(MOCK_PROJECT_ROOT, customOutputPath);

			expect(fsWriteFileSyncSpy).toHaveBeenCalledWith(resolvedCustomPath, expect.any(String));
		});
	});

	describe('expand command (input path for complexity report)', () => {
		const baseTask = { id: 1, title: "Expandable Task", description: "Needs subtasks", details: "Expand me", subtasks: [] };

		test('Scenario 2.1: Report in scripts/task-complexity-report.json', async () => {
			const reportPathScripts = path.join(MOCK_PROJECT_ROOT, 'scripts/task-complexity-report.json');
			const reportContent = { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: 3, expansionPrompt: "From scripts report" }] };
			
			fsReadFileSyncSpy.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return JSON.stringify({ tasks: [{...baseTask}] });
				if (filePath === reportPathScripts) return JSON.stringify(reportContent);
				throw new Error(`Unexpected read in 2.1: ${filePath}`);
			});
			fsExistsSyncSpy.mockImplementation(p => p.endsWith('tasks.json') || p === reportPathScripts);

			mockGenerateTextService.mockResolvedValueOnce({
				mainResult: JSON.stringify({
					subtasks: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, title: `Subtask ${i+1} from scripts`, description: "...", dependencies: [], details: "...", status: "pending" }))
				}),
				telemetryData: {}
			});

			const options = { id: '1', file: 'tasks/tasks.json' };
			await expandAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });

			expect(fsReadFileSyncSpy).toHaveBeenCalledWith(reportPathScripts, 'utf-8');
			expect(mockWriteJSON).toHaveBeenCalledWith(
				path.join(MOCK_PROJECT_ROOT, 'tasks/tasks.json'),
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 1, subtasks: expect.arrayContaining([
							expect.objectContaining({ title: 'Subtask 1 from scripts' })
						]) })
					])
				})
			);
		});
		
		test('Scenario 2.2: Report in tasks/task-complexity-report.json (not in scripts/)', async () => {
			const reportPathTasks = path.join(MOCK_PROJECT_ROOT, 'tasks/task-complexity-report.json');
			const reportPathScripts = path.join(MOCK_PROJECT_ROOT, 'scripts/task-complexity-report.json');
			const reportContent = { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: 2, expansionPrompt: "From tasks report" }] };

			fsReadFileSyncSpy.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return JSON.stringify({ tasks: [{...baseTask}] });
				if (filePath === reportPathTasks) return JSON.stringify(reportContent);
				throw new Error(`Unexpected read in 2.2: ${filePath}`);
			});
			fsExistsSyncSpy.mockImplementation(p => {
				if (p.endsWith('tasks.json')) return true;
				if (p === reportPathTasks) return true;
				if (p === reportPathScripts) return false; // Explicitly scripts/ report does not exist
				return false;
			});
			
			mockGenerateTextService.mockResolvedValueOnce({
				mainResult: JSON.stringify({
					subtasks: Array.from({ length: 2 }, (_, i) => ({ id: i + 1, title: `Subtask ${i+1} from tasks`, description: "...", dependencies: [], details: "...", status: "pending" }))
				}),
				telemetryData: {}
			});

			const options = { id: '1', file: 'tasks/tasks.json' };
			await expandAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });

			expect(fsReadFileSyncSpy).toHaveBeenCalledWith(reportPathTasks, 'utf-8');
			expect(mockWriteJSON).toHaveBeenCalledWith( // writeJSON is from the mocked utils
				path.join(MOCK_PROJECT_ROOT, 'tasks/tasks.json'),
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 1, subtasks: expect.arrayContaining([
							expect.objectContaining({ title: 'Subtask 1 from tasks' })
						]) })
					])
				})
			);
		});

		test('Scenario 2.3: Report in both scripts/ and tasks/ (scripts/ takes precedence)', async () => {
			const reportPathScripts = path.join(MOCK_PROJECT_ROOT, 'scripts/task-complexity-report.json');
			const reportPathTasks = path.join(MOCK_PROJECT_ROOT, 'tasks/task-complexity-report.json');
			const reportContentScripts = { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: 3, expansionPrompt: "From scripts report (priority)" }] };
			const reportContentTasks = { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: 2, expansionPrompt: "From tasks report (lower priority)" }] };

			fsReadFileSyncSpy.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return JSON.stringify({ tasks: [{...baseTask}] });
				if (filePath === reportPathScripts) return JSON.stringify(reportContentScripts);
				if (filePath === reportPathTasks) return JSON.stringify(reportContentTasks); // Should not be read
				throw new Error(`Unexpected read in 2.3: ${filePath}`);
			});
			// Both exist
			fsExistsSyncSpy.mockImplementation(p => p.endsWith('tasks.json') || p === reportPathScripts || p === reportPathTasks);
			
			mockGenerateTextService.mockResolvedValueOnce({
				mainResult: JSON.stringify({
					subtasks: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, title: `Subtask ${i+1} from scripts (priority)`, description: "...", dependencies: [], details: "...", status: "pending" }))
				}),
				telemetryData: {}
			});

			const options = { id: '1', file: 'tasks/tasks.json' };
			await expandAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });
			
			expect(fsReadFileSyncSpy).toHaveBeenCalledWith(reportPathScripts, 'utf-8');
			expect(fsReadFileSyncSpy).not.toHaveBeenCalledWith(reportPathTasks, 'utf-8'); // Verify tasks/ one was NOT read
			expect(mockWriteJSON).toHaveBeenCalledWith(
				path.join(MOCK_PROJECT_ROOT, 'tasks/tasks.json'),
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 1, subtasks: expect.arrayContaining([
							expect.objectContaining({ title: 'Subtask 1 from scripts (priority)' })
						]) })
					])
				})
			);
		});
		
		test('Scenario 2.4: No report in scripts/ or tasks/ (fallback to default subtask count)', async () => {
			const reportPathScripts = path.join(MOCK_PROJECT_ROOT, 'scripts/task-complexity-report.json');
			const reportPathTasks = path.join(MOCK_PROJECT_ROOT, 'tasks/task-complexity-report.json');

			fsReadFileSyncSpy.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return JSON.stringify({ tasks: [{...baseTask}] });
				throw new Error(`Unexpected read in 2.4 (report should not be found): ${filePath}`);
			});
			// Neither report exists
			fsExistsSyncSpy.mockImplementation(p => p.endsWith('tasks.json')); // Only tasks.json exists

			mockGenerateTextService.mockResolvedValueOnce({ // AI will use default subtask count
				mainResult: JSON.stringify({
					subtasks: Array.from({ length: mockDefaultSubtasks }, (_, i) => ({ id: i + 1, title: `Default Subtask ${i+1}`, description: "...", dependencies: [], details: "...", status: "pending" }))
				}),
				telemetryData: {}
			});
			
			const options = { id: '1', file: 'tasks/tasks.json' };
			await expandAction(options, { mcpLog: mockLog, projectRoot: MOCK_PROJECT_ROOT });

			expect(fsReadFileSyncSpy).not.toHaveBeenCalledWith(reportPathScripts, 'utf-8');
			expect(fsReadFileSyncSpy).not.toHaveBeenCalledWith(reportPathTasks, 'utf-8');
			expect(mockLog).toHaveBeenCalledWith('warn', expect.stringContaining('Complexity report not found in default locations'));
			expect(mockWriteJSON).toHaveBeenCalledWith(
				path.join(MOCK_PROJECT_ROOT, 'tasks/tasks.json'),
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 1, subtasks: expect.arrayContaining([
							expect.objectContaining({ title: 'Default Subtask 1' })
						]) })
					])
				})
			);
		});
	});
});

// Note: Scenario 2.5 is intentionally omitted as `expand` does not take an explicit report path.
// The `findComplexityReport` unit tests should cover explicit path handling.
