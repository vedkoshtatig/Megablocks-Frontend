import './styles.css';
import { MegablocksGame } from './world/MegablocksGame';

const canvas = document.querySelector<HTMLCanvasElement>('#game');

if (!canvas) {
  throw new Error('Game canvas was not found.');
}

const game = new MegablocksGame(canvas);
game.start();
