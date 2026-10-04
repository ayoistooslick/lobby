import { Link } from "react-router-dom";
import { useDocumentTitle } from "../lib/hooks";

export default function About() {
  useDocumentTitle("About the developer, Lobby");

  return (
    <main className="page narrow">
      <article className="about">
        <img
          src="https://res.cloudinary.com/dejkqmt3q/image/upload/v1791147133/linkforge/file_amiw7z.jpg"
          alt="Portrait of Ayodele Ayokunle David"
          width={148}
          height={148}
          className="about-photo"
        />
        <p className="eyebrow">About the developer</p>
        <h1>Ayodele Ayokunle David</h1>
        <p className="lede">I'm a teenager who builds software and experiments with useful ideas.</p>
        <p>
          Lobby is one of those ideas. It started small, a place where people could take a number
          on their phone instead of crowding around a counter, and I decided to build the whole
          thing myself: the interface, the server, and the little real-time parts that make the
          screen update on its own.
        </p>
        <p>
          There's no big company behind it and no invented story. Just code I'm happy to put my
          name on, released under the MIT licence so anyone can read it, run it, or change it.
        </p>
        <p>
          If you want to see the other things I'm working on, have a look at my portfolio:
        </p>
        <p>
          <a
            href="https://ayo-portal.netlify.app"
            target="_blank"
            rel="noreferrer noopener"
            className="about-link"
          >
            ayo-portal.netlify.app →
          </a>
        </p>
        <p>
          <Link to="/" className="link-button">
            ← Back to Lobby
          </Link>
        </p>
      </article>
    </main>
  );
}
