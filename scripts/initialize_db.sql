-- PostgreSQL initialization

-- Create the user if not already created
CREATE USER ctabot WITH PASSWORD 'bulbasaur';

-- Create database
CREATE DATABASE ctabot;

-- Grant connection privilege on the database
GRANT CONNECT ON DATABASE ctabot TO ctabot;

-- Grant all privileges on all tables in the public schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ctabot;

-- Grant all privileges on all sequences in the public schema
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ctabot;

-- Grant EXECUTE on all functions in the public schema (if needed)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ctabot;

-- Grant CREATE privilege in the public schema to allow creating new objects (optional)
GRANT CREATE ON SCHEMA public TO ctabot;

-- Ensure the user gets these privileges on future tables, sequences, and functions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ctabot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ctabot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ctabot;

--
-- Name: compositions; Type: TABLE; Schema: public; Owner: ctabot
--

CREATE TABLE public.compositions (
    discord_id bigint NOT NULL,
    comp_name character varying(255) NOT NULL,
    owner bigint
);


ALTER TABLE public.compositions OWNER TO ctabot;

--
-- Name: events; Type: TABLE; Schema: public; Owner: ctabot
--

CREATE TABLE public.events (
    event_id bigint NOT NULL,
    event_name character varying(255),
    user_id bigint,
    discord_id bigint,
    comp_name character varying(255),
    date character varying(255),
    time_utc character varying(255)
);


ALTER TABLE public.events OWNER TO ctabot;

--
-- Name: participants; Type: TABLE; Schema: public; Owner: ctabot
--

CREATE TABLE public.participants (
    user_id bigint NOT NULL,
    role_id integer NOT NULL,
    comp_name character varying(255) NOT NULL,
    event_id bigint NOT NULL,
    discord_id bigint NOT NULL
);


ALTER TABLE public.participants OWNER TO ctabot;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: ctabot
--

CREATE TABLE public.roles (
    role_id integer NOT NULL,
    discord_id bigint NOT NULL,
    comp_name character varying(255) NOT NULL,
    party character varying(255) NOT NULL,
    role_name character varying(255)
);


ALTER TABLE public.roles OWNER TO ctabot;

--
-- Name: compositions compositions_pkey; Type: CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.compositions
    ADD CONSTRAINT compositions_pkey PRIMARY KEY (discord_id, comp_name);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (event_id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (user_id, event_id, discord_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id, comp_name, discord_id);


--
-- Name: events events_discord_id_comp_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_discord_id_comp_name_fkey FOREIGN KEY (discord_id, comp_name) REFERENCES public.compositions(discord_id, comp_name) ON DELETE CASCADE;


--
-- Name: participants participants_role_id_comp_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_role_id_comp_name_fkey FOREIGN KEY (role_id, comp_name, discord_id) REFERENCES public.roles(role_id, comp_name, discord_id) ON DELETE CASCADE;


--
-- Name: roles roles_comp_name_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ctabot
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_comp_name_discord_id_fkey FOREIGN KEY (comp_name, discord_id) REFERENCES public.compositions(comp_name, discord_id) ON DELETE CASCADE;

--