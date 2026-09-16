import { useState } from 'react';
import './App.css';
import { Lexer } from './Lexer';

function App() {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState('');
  const lexer = new Lexer(submitted);
  const handleClick = () => {
    setSubmitted(text);
    console.log(submitted);
  };
  const tokens = [];

  const handleGenerate = () => {
    tokens.push(lexer.tokenize());
    console.log(tokens);
  };

  return (
    <>
      <div>
        <textarea name="" id="" onChange={(e) => setText(e.target.value)}></textarea>
        <button onClick={handleClick}>Send</button>
        <button onClick={handleGenerate}>Generate</button>
      </div>

      <div>{tokens}</div>
    </>
  );
}

export default App;
