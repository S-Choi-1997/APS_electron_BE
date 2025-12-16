--
-- PostgreSQL database dump
--

\restrict SoIsZEaZQimaUrz9KajRaEFXac4Jj4pGINAfwqDyFmfrwUyuVP2lgzCb3JxWXzp

-- Dumped from database version 15.15
-- Dumped by pg_dump version 15.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: apsuser
--

INSERT INTO public.users VALUES ('nothingjustfake@gmail.com', '최승호', 'local', 'admin', true, '2025-12-15 06:54:29.600098', '2025-12-15 06:54:29.600098', '2025-12-15 06:54:29.600098', '$2b$12$B.HawiyVE7YmZwgWe0lv8.GV6QYVc0MAqNU6ds3x8XLZsgitkf9D2');
INSERT INTO public.users VALUES ('infra.steve.01@gmail.com', '관리자2', 'local', 'admin', true, '2025-12-13 19:43:17.748032', '2025-12-15 07:54:06.737092', '2025-12-13 19:43:17.748032', '$2b$12$k1WyHqddeLzTWJ5sossT.eGdgBIDEjHhNGeo7wZVWk4nDrADSamBK');


--
-- Data for Name: email_inquiries; Type: TABLE DATA; Schema: public; Owner: apsuser
--



--
-- Data for Name: memos; Type: TABLE DATA; Schema: public; Owner: apsuser
--

INSERT INTO public.memos VALUES (50, 'dfssdffsd', 'dfssdffsd', false, 'infra.steve.01@gmail.com', '2025-12-14 11:18:13.87277', '2025-12-14 11:25:35.319942', '2025-12-14', '2025-12-14 11:25:35.319942');
INSERT INTO public.memos VALUES (49, 'feqafqeafqfea', 'feqafqeafqfea', false, 'infra.steve.01@gmail.com', '2025-12-14 11:15:53.283106', '2025-12-14 11:25:37.261515', '2025-12-14', '2025-12-14 11:25:37.261515');
INSERT INTO public.memos VALUES (48, 'asdadasdadasdad', 'asdadasdadasdad', false, 'infra.steve.01@gmail.com', '2025-12-14 09:57:02.839532', '2025-12-14 11:25:38.79662', '2025-12-14', '2025-12-14 11:25:38.79662');
INSERT INTO public.memos VALUES (47, '참치김밥도', '참치김밥도
', false, 'infra.steve.01@gmail.com', '2025-12-14 09:46:53.343977', '2025-12-14 11:25:41.307245', '2025-12-14', '2025-12-14 11:25:41.307245');
INSERT INTO public.memos VALUES (46, '김치찌개를 먹고싶어요', '김치찌개를 먹고싶어요', false, 'infra.steve.01@gmail.com', '2025-12-14 09:46:37.596562', '2025-12-14 11:25:43.470255', '2025-12-14', '2025-12-14 11:25:43.470255');
INSERT INTO public.memos VALUES (51, 'sasdasdasd', 'sasdasdasd', false, 'infra.steve.01@gmail.com', '2025-12-14 11:26:00.585173', '2025-12-14 11:26:00.585173', '2025-12-14', NULL);
INSERT INTO public.memos VALUES (52, '메모추가', 'ㅁㄴㅇ', false, 'nothingjustfake@gmail.com', '2025-12-15 06:56:43.912537', '2025-12-15 06:56:43.912537', '2025-12-15', NULL);
INSERT INTO public.memos VALUES (53, 'fadaadfad', 'fadaadfad', false, 'infra.steve.01@gmail.com', '2025-12-15 07:15:58.421084', '2025-12-15 07:15:58.421084', '2025-12-15', NULL);
INSERT INTO public.memos VALUES (54, 'adfadfadfaf', 'adfadfadfaf', false, 'infra.steve.01@gmail.com', '2025-12-15 07:26:43.484952', '2025-12-15 07:26:43.484952', '2025-12-15', NULL);


--
-- Data for Name: schedules; Type: TABLE DATA; Schema: public; Owner: apsuser
--

INSERT INTO public.schedules VALUES (17, '회식', NULL, '2025-12-14', '2025-12-14', 'company', 'infra.steve.01@gmail.com', '2025-12-14 09:47:07.206745', '2025-12-14 09:47:07.206745', NULL);
INSERT INTO public.schedules VALUES (18, '집가고싶다', NULL, '2025-12-14', '2025-12-14', 'personal', 'infra.steve.01@gmail.com', '2025-12-14 09:47:21.635443', '2025-12-14 11:15:36.074635', '2025-12-14 11:15:36.074635');
INSERT INTO public.schedules VALUES (19, 'asdad', NULL, '2025-12-14', '2025-12-14', 'personal', 'infra.steve.01@gmail.com', '2025-12-14 11:15:39.346366', '2025-12-14 11:15:39.346366', NULL);
INSERT INTO public.schedules VALUES (20, 'asdasdasd', NULL, '2025-12-14', '2025-12-14', 'personal', 'infra.steve.01@gmail.com', '2025-12-14 11:26:11.236415', '2025-12-14 11:26:11.236415', NULL);
INSERT INTO public.schedules VALUES (21, '다른계정테스트', NULL, '2025-12-15', '2025-12-15', 'company', 'nothingjustfake@gmail.com', '2025-12-15 06:56:02.611478', '2025-12-15 06:56:02.611478', NULL);
INSERT INTO public.schedules VALUES (22, '집에 가고싶은 나야', NULL, '2025-12-15', '2025-12-15', 'personal', 'infra.steve.01@gmail.com', '2025-12-15 07:27:27.183685', '2025-12-15 07:27:27.183685', NULL);


--
-- Data for Name: sync_status; Type: TABLE DATA; Schema: public; Owner: apsuser
--

INSERT INTO public.sync_status VALUES (1, 'gmail', '2025-12-11 04:27:44.928035', NULL, 'idle', NULL, 0, 0);
INSERT INTO public.sync_status VALUES (2, 'web_form_firestore', '2025-12-11 04:27:44.928035', NULL, 'idle', NULL, 0, 0);


--
-- Data for Name: web_form_inquiries; Type: TABLE DATA; Schema: public; Owner: apsuser
--



--
-- Name: memos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: apsuser
--

SELECT pg_catalog.setval('public.memos_id_seq', 54, true);


--
-- Name: schedules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: apsuser
--

SELECT pg_catalog.setval('public.schedules_id_seq', 22, true);


--
-- Name: sync_status_id_seq; Type: SEQUENCE SET; Schema: public; Owner: apsuser
--

SELECT pg_catalog.setval('public.sync_status_id_seq', 2, true);


--
-- PostgreSQL database dump complete
--

\unrestrict SoIsZEaZQimaUrz9KajRaEFXac4Jj4pGINAfwqDyFmfrwUyuVP2lgzCb3JxWXzp

